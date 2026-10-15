import { Command, InvalidArgumentError } from "commander";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import packageJson from "../package.json" with { type: "json" };
import { parseDuration } from "./duration.ts";
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
type Flags = Partial<Settings> & { input: boolean; timeoutMs?: number };
type Parsed<T> = { value: T } | { error: string };
type Outcome = (CheckoutResult & { price: number }) | { kind: "timed-out"; afterMs: number };

const HOME = join(process.env.LOCALAPPDATA ?? process.cwd(), "amazon-bot");
const SETTINGS_FILE = join(HOME, "settings.json");
const PROFILE_DIR = join(HOME, "profile");
const POLL_MS = 15_000;
const BEEP = "\x07";
// The product this bot was built to buy: Nintendo Switch 2 – The Legend of
// Zelda 40th Anniversary Edition. Nintendo of Canada lists it at CAD 709.99;
// the limit leaves about 3% for Amazon pricing just above that, and stays far
// below reseller prices.
const DEFAULT_URL =
	"https://www.amazon.ca/Nintendo-Switch-Legend-Anniversary-Console/dp/B0F2TP12QL/ref=sr_1_2?sr=8-2";
const DEFAULT_MAX_PRICE = 730;
const EXAMPLES = [
	"",
	"Defaults:",
	`  --url        ${DEFAULT_URL}`,
	"               (Nintendo Switch 2 - The Legend of Zelda 40th Anniversary Edition)",
	`  --max-price  ${DEFAULT_MAX_PRICE} (CAD), about 3% above Nintendo's CAD 709.99, and only`,
	"               for the default --url; any other --url needs its own price",
	"",
	"Settings you leave out are asked for, with your last answers or the defaults",
	"above in [brackets]. Without a terminal, or with --no-input, the bot never",
	"asks: it uses the defaults, and it is a dry run unless you pass --no-dry-run.",
	"",
	"Examples:",
	"  $ amazon-bot",
	"  $ amazon-bot --no-input --dry-run",
	"  $ amazon-bot --url https://www.amazon.ca/dp/B014I8SSD0 --max-price 10 --no-dry-run",
].join("\n");

class BrowserClosed extends Error {}
class NoAnswer extends Error {}
class MissingMaxPrice extends Error {}
// Amazon needs a person (sign-in, typed captcha), but nobody is there to help.
class NeedsPerson extends Error {}
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
		.option(
			"--url <url>",
			"Amazon product page link (default: the Switch 2 Zelda edition below)",
			parseFlag(parsers.url),
		)
		.option(
			"--max-price <price>",
			`highest price you will pay, in the store's currency (CAD on amazon.ca) (default: ${DEFAULT_MAX_PRICE} for the default --url)`,
			parseFlag(parsers.maxPrice),
		)
		.option("-n, --dry-run", "stop at the place-order button; nothing is bought (default)")
		.option("--no-dry-run", "place a real order and pay")
		.option("--no-input", "never ask questions; use flags and defaults only")
		.option(
			"--timeout <duration>",
			"stop watching after this long without buying, for example 90s, 30m, or 2h (default: never)",
			parseFlag((text) => {
				const ms = parseDuration(text);
				return ms === null
					? { error: "Use a number with s, m, or h, for example 90s or 2h." }
					: { value: ms };
			}),
		)
		.version(packageJson.version)
		.addHelpText("after", EXAMPLES)
		.showHelpAfterError("(run amazon-bot --help for usage)")
		.parse();
	const options = program.opts<{
		url?: string;
		maxPrice?: number;
		dryRun?: boolean;
		input: boolean;
		timeout?: number;
	}>();
	return {
		url: options.url,
		maxPrice: options.maxPrice,
		placeOrder: options.dryRun === undefined ? undefined : !options.dryRun,
		input: options.input,
		timeoutMs: options.timeout,
	};
}

// The default limit was chosen for the default product; reusing it for another
// product would be a guess with the user's money.
function defaultMaxPrice(url: string): number | undefined {
	return url === DEFAULT_URL ? DEFAULT_MAX_PRICE : undefined;
}

async function resolveSettings(flags: Flags, interactive: boolean): Promise<Settings> {
	if (interactive) return askSettings(flags);
	const url = flags.url ?? DEFAULT_URL;
	const maxPrice = flags.maxPrice ?? defaultMaxPrice(url);
	if (maxPrice === undefined) throw new MissingMaxPrice();
	// Spending money must be asked for explicitly, never inherited from a saved answer.
	return { url, maxPrice, placeOrder: flags.placeOrder ?? false };
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
		fallback: Settings[K] | undefined,
		show: (value: Settings[K]) => string = String,
	): Promise<Settings[K]> {
		const previous = saved[key] ?? fallback;
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
		const url = flags.url ?? (await ask("Amazon product link", "url", DEFAULT_URL));
		const currency = currencyFor(url) ?? "the currency the product page shows";
		settings = {
			url,
			maxPrice:
				flags.maxPrice ??
				(await ask(
					`Highest price you will pay, in ${currency} (number only)`,
					"maxPrice",
					defaultMaxPrice(url),
				)),
			placeOrder:
				flags.placeOrder ??
				(await ask(
					"Really buy it? yes = PLACE A REAL ORDER and pay, no = test run that stops before paying",
					"placeOrder",
					false,
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

type WatchOptions = { interactive: boolean; timeoutMs: number | undefined };

async function watch(
	page: Page,
	{ url, maxPrice, placeOrder }: Settings,
	{ interactive, timeoutMs }: WatchOptions,
): Promise<Outcome> {
	const deadline = timeoutMs === undefined ? Infinity : Date.now() + timeoutMs;
	// Playwright reads a timeout of 0 as "no limit".
	const humanWaitMs = () => (deadline === Infinity ? 0 : Math.max(1, deadline - Date.now()));
	for (;;) {
		// The deadline is checked only between checks, never during checkout, so a
		// timeout can't cut off an order after the place-order click.
		if (Date.now() >= deadline) return { kind: "timed-out", afterMs: timeoutMs ?? 0 };
		let waitMessage: string;
		try {
			await page.goto(url, { waitUntil: "domcontentloaded" });
			const verdict = judge(await readSnapshot(page), maxPrice);
			switch (verdict.kind) {
				case "captcha":
					await handleCaptcha(
						page,
						() => {
							if (!interactive) {
								throw new NeedsPerson(
									"Amazon wants the characters of a captcha typed, and nobody is here to type them.",
								);
							}
							console.log(
								`${BEEP}Amazon wants to check you are human. Type the characters in the Edge window.`,
							);
						},
						humanWaitMs(),
					);
					continue;
				case "signed-out":
					if (!interactive) {
						throw new NeedsPerson(
							"The bot's Edge profile is not signed in to Amazon. Run amazon-bot once from a terminal, or by double-clicking it, and sign in.",
						);
					}
					await signIn(
						page,
						() =>
							console.log(
								`${BEEP}Please sign in to Amazon in the Edge window, with a password, passkey, or code, whichever Amazon asks for. The bot waits for you and carries on once Amazon shows you signed in.`,
							),
						humanWaitMs(),
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
					return { ...result, price: verdict.price };
				}
			}
		} catch (err) {
			if (err instanceof NeedsPerson) throw err;
			if (page.isClosed()) throw new BrowserClosed();
			// Retrying is safe: Buy Now alone buys nothing, and checkout never throws
			// after the place-order click.
			const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
			waitMessage = `Page problem (${reason}).`;
		}
		const wait = Math.max(0, Math.min(jitter(POLL_MS), deadline - Date.now()));
		status(`${waitMessage} Checking again in ${Math.round(wait / 1000)}s.`);
		await sleep(wait);
	}
}

// Prints how the run ended and returns the exit code: 0 means the run did its
// job, 1 means it failed or needs a person, and 2 means --timeout ran out first.
function report(result: Outcome): number {
	switch (result.kind) {
		case "ordered":
			console.log(
				`\n${BEEP}Order placed at ${result.price}! Check your email or Amazon orders for the confirmation.`,
			);
			return 0;
		case "checkout-not-found":
			console.log("\nCheckout needs your attention. No order was placed; check the Edge window.");
			return 1;
		case "test-stopped":
			console.log(
				`\nTest run worked: it reached the "Place your order" button at ${result.price} and stopped. Nothing was bought.`,
			);
			return 0;
		case "unconfirmed":
			console.log(
				'\nThe bot clicked "Place your order" but did not see the confirmation page.\n' +
					"Check your Amazon orders before running the bot again, so you do not buy twice.",
			);
			return 1;
		case "timed-out":
			console.log(
				`\nStopped after ${Math.round(result.afterMs / 1000)}s (--timeout) without buying anything.`,
			);
			return 2;
		default: {
			const unhandled: never = result;
			return unhandled;
		}
	}
}

async function main(flags: Flags, interactive: boolean): Promise<Outcome> {
	const settings = await resolveSettings(flags, interactive);
	const currency = currencyFor(settings.url);
	console.log(`\nWatching ${settings.url}`);
	console.log(`Buying at ${settings.maxPrice}${currency ? ` ${currency}` : ""} or less.`);
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
	return watch(page, settings, { interactive, timeoutMs: flags.timeoutMs });
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
		process.exitCode = report(result);
	})
	.catch((err) => {
		process.exitCode = 1;
		if (err instanceof NeedsPerson) {
			console.error(`\nerror: ${err.message}`);
		} else if (err instanceof MissingMaxPrice) {
			console.error(
				"error: --max-price is required with a --url other than the default when the bot cannot ask questions (no terminal, or --no-input).\n" +
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
