import { Command, InvalidArgumentError } from "commander";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import packageJson from "../package.json" with { type: "json" };
import {
	checkout,
	currencyFor,
	dismissOverlays,
	handleCaptcha,
	judge,
	parsePrice,
	readSnapshot,
	signIn,
	type CheckoutResult,
} from "./amazon.ts";

type Settings = { url: string; maxPrice: number; placeOrder: boolean };
// A setting left undefined was not passed on the command line.
type Flags = Partial<Settings> & { input: boolean };
type Parsed<T> = { value: T } | { error: string };
type Outcome = Exclude<CheckoutResult, { kind: "checkout-not-found" }> & { price: number };

const HOME = join(process.env.LOCALAPPDATA ?? process.cwd(), "amazon-bot");
const SETTINGS_FILE = join(HOME, "settings.json");
const PROFILE_DIR = join(HOME, "profile");
const POLL_MS = 15_000;
const BEEP = "\x07";
const EXAMPLES = [
	"",
	"Settings you leave out are asked for, with your last answers as defaults.",
	"Without a terminal, or with --no-input, --url and --max-price are required and",
	"the run is a dry run unless you pass --no-dry-run.",
	"",
	"Examples:",
	"  $ amazon-bot",
	"  $ amazon-bot --url https://www.amazon.ca/dp/B014I8SSD0 --max-price 10 --dry-run",
	"  $ amazon-bot --url https://www.amazon.ca/dp/B014I8SSD0 --max-price 10 --no-dry-run",
].join("\n");

class BrowserClosed extends Error {}
class NoAnswer extends Error {}
class MissingFlag extends Error {}
let context: BrowserContext | undefined;

const parsers: { [K in keyof Settings]: (answer: string) => Parsed<Settings[K]> } = {
	url(answer) {
		try {
			const url = new URL(answer);
			if (/^https?:$/.test(url.protocol) && url.hostname.includes("amazon."))
				return { value: url.href };
		} catch {}
		return {
			error:
				"That does not look like an Amazon link. Copy it from the address bar of the product page.",
		};
	},
	maxPrice(answer) {
		const value = parsePrice(answer);
		return value !== null && value > 0
			? { value }
			: { error: "Please type a price, for example 49.99" };
	},
	placeOrder(answer) {
		if (/^y(es)?$/i.test(answer)) return { value: true };
		if (/^n(o)?$/i.test(answer)) return { value: false };
		return { error: "Please type yes or no." };
	},
};

async function loadSettings(): Promise<Partial<Settings>> {
	let saved: unknown;
	try {
		saved = JSON.parse(await readFile(SETTINGS_FILE, "utf8"));
	} catch {
		return { placeOrder: false };
	}
	if (typeof saved !== "object" || saved === null) return { placeOrder: false };
	return {
		url: "url" in saved && typeof saved.url === "string" ? saved.url : undefined,
		maxPrice:
			"maxPrice" in saved && typeof saved.maxPrice === "number" && saved.maxPrice > 0
				? saved.maxPrice
				: undefined,
		placeOrder:
			"placeOrder" in saved && typeof saved.placeOrder === "boolean" ? saved.placeOrder : false,
	};
}

function parseFlag<T>(parse: (value: string) => Parsed<T>) {
	return (value: string): T => {
		const result = parse(value);
		if ("error" in result) throw new InvalidArgumentError(result.error);
		return result.value;
	};
}

function readFlags(): Flags {
	const program = new Command("amazon-bot")
		.description(
			"Watch an Amazon product page and buy it when it is back in stock at or under your price.",
		)
		.option("--url <url>", "Amazon product page link", parseFlag(parsers.url))
		.option(
			"--max-price <price>",
			"highest price you will pay, in the store's currency (CAD on amazon.ca)",
			parseFlag(parsers.maxPrice),
		)
		.option("-n, --dry-run", "stop at the place-order button; nothing is bought")
		.option("--no-dry-run", "place a real order and pay")
		.option("--no-input", "never ask questions; fail if a required setting is missing")
		.version(packageJson.version)
		.addHelpText("after", EXAMPLES)
		.showHelpAfterError("(run amazon-bot --help for usage)")
		.parse();
	const options = program.opts<{
		url?: string;
		maxPrice?: number;
		dryRun?: boolean;
		input: boolean;
	}>();
	return {
		url: options.url,
		maxPrice: options.maxPrice,
		placeOrder: options.dryRun === undefined ? undefined : !options.dryRun,
		input: options.input,
	};
}

async function resolveSettings(flags: Flags, interactive: boolean): Promise<Settings> {
	if (interactive) return askSettings(flags);
	if (flags.url === undefined) throw new MissingFlag("--url");
	if (flags.maxPrice === undefined) throw new MissingFlag("--max-price");
	// Spending money must be asked for explicitly, never inherited from a saved answer.
	return { url: flags.url, maxPrice: flags.maxPrice, placeOrder: flags.placeOrder ?? false };
}

async function askSettings(flags: Partial<Settings>): Promise<Settings> {
	const saved = await loadSettings();
	const answered: Partial<Settings> = {};
	console.log("Amazon restock bot. Press Enter to keep the value in [brackets].\n");
	// One interface for every question: with pasted input, a fresh interface per
	// question would drop lines that were already read into the previous one.
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const lines = rl[Symbol.asyncIterator]();
	async function ask<K extends keyof Settings>(
		question: string,
		key: K,
		show: (value: Settings[K]) => string = String,
	): Promise<Settings[K]> {
		const previous = saved[key];
		for (;;) {
			const hint = previous === undefined ? "" : ` [${show(previous)}]`;
			process.stdout.write(`${question}${hint}: `);
			const { value, done } = await lines.next();
			if (done) throw new NoAnswer();
			const answer = value.trim();
			const result: Parsed<Settings[K]> =
				answer === "" && previous !== undefined ? { value: previous } : parsers[key](answer);
			if ("value" in result) {
				answered[key] = result.value;
				return result.value;
			}
			console.log(result.error);
		}
	}
	let settings: Settings;
	try {
		const url = flags.url ?? (await ask("Amazon product link", "url"));
		const currency = currencyFor(url) ?? "the currency the product page shows";
		settings = {
			url,
			maxPrice:
				flags.maxPrice ??
				(await ask(`Highest price you will pay, in ${currency} (number only)`, "maxPrice")),
			placeOrder:
				flags.placeOrder ??
				(await ask(
					"Really buy it? yes = PLACE A REAL ORDER and pay, no = test run that stops before paying",
					"placeOrder",
					(v) => (v ? "yes, real order" : "no, test run"),
				)),
		};
	} finally {
		rl.close();
	}
	// Flags are one-off; only typed answers become the next run's defaults.
	if (Object.keys(answered).length > 0) {
		await mkdir(HOME, { recursive: true });
		await writeFile(SETTINGS_FILE, JSON.stringify({ ...saved, ...answered }, null, 2));
	}
	return settings;
}

const status = (message: string) => console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
const jitter = (ms: number) => Math.round(ms * (0.75 + Math.random() * 0.5));

async function watch(page: Page, { url, maxPrice, placeOrder }: Settings): Promise<Outcome> {
	for (;;) {
		let waitMessage: string;
		try {
			await page.goto(url, { waitUntil: "domcontentloaded" });
			const verdict = judge(await readSnapshot(page), maxPrice);
			switch (verdict.kind) {
				case "captcha":
					await handleCaptcha(page, () =>
						console.log(
							`${BEEP}Amazon wants to check you are human. Type the characters in the Edge window.`,
						),
					);
					continue;
				case "signed-out":
					await signIn(page, () =>
						console.log(
							`${BEEP}Please sign in to Amazon in the Edge window. The bot waits for you.`,
						),
					);
					status("Signed in.");
					continue;
				case "unavailable":
					waitMessage = "Buy Now is not available yet.";
					break;
				case "no-price":
					waitMessage = "Buy Now is there but no price was found.";
					break;
				case "too-expensive":
					waitMessage = `Price is ${verdict.price}, above your limit of ${maxPrice}.`;
					break;
				case "buy": {
					status(`Price is ${verdict.price}. Clicking Buy Now!`);
					const result = await checkout(page, placeOrder);
					if (result.kind === "checkout-not-found") {
						waitMessage = "Clicked Buy Now but the checkout page did not show up.";
						break;
					}
					return { ...result, price: verdict.price };
				}
			}
		} catch (err) {
			if (page.isClosed()) throw new BrowserClosed();
			// Retrying is safe: Buy Now alone buys nothing, and checkout never throws
			// after the place-order click.
			const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
			waitMessage = `Page problem (${reason}).`;
		}
		const wait = jitter(POLL_MS);
		status(`${waitMessage} Checking again in ${Math.round(wait / 1000)}s.`);
		await sleep(wait);
	}
}

const outcomes: { [K in Outcome["kind"]]: (r: Outcome) => string } = {
	ordered: (r) =>
		`${BEEP}Order placed at ${r.price}! Check your email or Amazon orders for the confirmation.`,
	unconfirmed: () =>
		'The bot clicked "Place your order" but did not see the confirmation page.\n' +
		"Check your Amazon orders before running the bot again, so you do not buy twice.",
	"test-stopped": (r) =>
		`Test run worked: it reached the "Place your order" button at ${r.price} and stopped. Nothing was bought.`,
};

async function main(flags: Flags, interactive: boolean): Promise<Outcome> {
	const settings = await resolveSettings(flags, interactive);
	console.log(
		settings.placeOrder
			? "\nREAL ORDER mode: it will buy."
			: "\nTest run: it will stop before paying.",
	);
	console.log("Opening Edge... leave the window open. Close it to stop the bot.\n");
	context = await chromium.launchPersistentContext(PROFILE_DIR, {
		channel: "msedge",
		headless: false,
		viewport: null,
	});
	const page = context.pages()[0] ?? (await context.newPage());
	await dismissOverlays(page);
	return watch(page, settings);
}

async function waitForEnter() {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	await new Promise<void>((resolve) => {
		rl.question("\nPress Enter to close.", () => resolve());
		rl.on("close", resolve);
	});
	rl.close();
}

// Commander prints help or usage errors and exits before anything else runs.
const flags = readFlags();
// Prompts and the closing pause need a person at a terminal.
const interactive = flags.input && process.stdin.isTTY === true;

// No top-level await: the exe bundle is CommonJS.
void main(flags, interactive)
	.then((result) => {
		console.log("\n" + outcomes[result.kind](result));
		process.exitCode = result.kind === "unconfirmed" ? 1 : 0;
	})
	.catch((err) => {
		process.exitCode = 1;
		if (err instanceof MissingFlag) {
			console.error(
				`error: ${err.message} is required when the bot cannot ask questions (no terminal, or --no-input).\n` +
					"(run amazon-bot --help for usage)",
			);
		} else if (
			err instanceof BrowserClosed ||
			(err instanceof Error && err.message.includes("has been closed"))
		) {
			console.error("\nThe Edge window was closed, so the bot stopped.");
		} else if (err instanceof NoAnswer) {
			console.error("\nNo answer was typed, so the bot stopped.");
		} else {
			console.error("\nSomething unexpected went wrong:");
			console.error(err);
		}
	})
	.then(() => (interactive ? waitForEnter() : undefined))
	.then(() => context?.close())
	.catch(() => {})
	.then(() => process.exit());
