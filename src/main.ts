import { chromium, type BrowserContext, type Page } from "playwright-core";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import {
	checkout,
	dismissOverlays,
	handleCaptcha,
	judge,
	parsePrice,
	readSnapshot,
	signIn,
	type CheckoutResult,
} from "./amazon.ts";

type Settings = { url: string; maxPrice: number; placeOrder: boolean };
type Parsed<T> = { value: T } | { error: string };
type Outcome = Exclude<CheckoutResult, { kind: "checkout-not-found" }> & { price: number };

const HOME = join(process.env.LOCALAPPDATA ?? process.cwd(), "amazon-bot");
const SETTINGS_FILE = join(HOME, "settings.json");
const PROFILE_DIR = join(HOME, "profile");
const POLL_MS = 15_000;
const BEEP = "\x07";

class BrowserClosed extends Error {}
class NoAnswer extends Error {}
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

async function askSettings(): Promise<Settings> {
	const saved = await loadSettings();
	// One interface for every question: with piped input, a fresh interface per
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
			if (answer === "" && previous !== undefined) return previous;
			const result = parsers[key](answer);
			if ("value" in result) return result.value;
			console.log(result.error);
		}
	}
	try {
		const url = await ask("Amazon product link", "url");
		const maxPrice = await ask("Highest price you will pay (number only)", "maxPrice");
		const placeOrder = await ask(
			"Really buy it? yes = PLACE A REAL ORDER and pay, no = test run that stops before paying",
			"placeOrder",
			(v) => (v ? "yes, real order" : "no, test run"),
		);
		const settings = { url, maxPrice, placeOrder };
		await mkdir(HOME, { recursive: true });
		await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
		return settings;
	} finally {
		rl.close();
	}
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

async function main() {
	console.log("Amazon restock bot. Press Enter to keep the value in [brackets].\n");
	const settings = await askSettings();
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
	const result = await watch(page, settings);
	console.log("\n" + outcomes[result.kind](result));
}

async function waitForEnter() {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	await new Promise<void>((resolve) => {
		rl.question("\nPress Enter to close.", () => resolve());
		rl.on("close", resolve);
	});
	rl.close();
}

// No top-level await: the exe bundle is CommonJS.
void main()
	.catch((err) => {
		if (
			err instanceof BrowserClosed ||
			(err instanceof Error && err.message.includes("has been closed"))
		) {
			console.log("\nThe Edge window was closed, so the bot stopped.");
		} else if (err instanceof NoAnswer) {
			console.log("\nNo answer was typed, so the bot stopped.");
		} else {
			console.log("\nSomething unexpected went wrong:");
			console.log(err);
		}
	})
	.then(waitForEnter)
	.then(() => context?.close())
	.catch(() => {})
	.then(() => process.exit(0));
