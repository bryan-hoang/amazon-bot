import { Command, InvalidArgumentError } from "commander";
import { chromium } from "playwright-core";
import { judge, parsePrice, readSnapshot } from "../src/amazon.ts";

function parseMaxPrice(value: string): number {
	const price = parsePrice(value);
	if (price === null || price <= 0) {
		throw new InvalidArgumentError("Expected a positive price, for example 49.99.");
	}
	return price;
}

const program = new Command("probe")
	.description("Check the bot's Amazon selectors against a live product page.")
	.argument("<url>", "Amazon product page URL")
	.option(
		"--max-price <price>",
		"highest price the bot would pay (default: no limit)",
		parseMaxPrice,
	)
	.addHelpText(
		"after",
		[
			"",
			"Opens <url> in headless Edge, reads the page the way the bot does, and prints",
			"that state and the bot's verdict as JSON on stdout. Run it when Amazon changes",
			"its pages, then fix the selectors in src/amazon.ts.",
			"",
			"Examples:",
			"  $ vp run probe https://www.amazon.ca/dp/B014I8SSD0",
			"  $ vp run probe https://www.amazon.ca/dp/B014I8SSD0 --max-price 10",
		].join("\n"),
	)
	.showHelpAfterError("(run vp run probe --help for usage)")
	.parse();
const [url] = program.args;
const { maxPrice = Infinity } = program.opts<{ maxPrice?: number }>();

const browser = await chromium.launch({ channel: "msedge" });
try {
	const page = await browser.newPage();
	await page.goto(url, { waitUntil: "domcontentloaded" });
	const snapshot = await readSnapshot(page);
	const verdict = judge(snapshot, maxPrice);
	console.log(
		JSON.stringify({ url: page.url(), title: await page.title(), snapshot, verdict }, null, 2),
	);
} finally {
	await browser.close();
}
