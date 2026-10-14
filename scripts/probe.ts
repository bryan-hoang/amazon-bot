import { chromium } from "playwright-core";
import { readSnapshot, judge } from "../src/amazon.ts";

const [url, maxPrice = "Infinity"] = process.argv.slice(2);
if (!url) {
	console.error("usage: vp run probe <amazon product url> [maxPrice]");
	process.exit(1);
}

const browser = await chromium.launch({ channel: "msedge" });
try {
	const page = await browser.newPage();
	await page.goto(url, { waitUntil: "domcontentloaded" });
	const snapshot = await readSnapshot(page);
	const verdict = judge(snapshot, Number(maxPrice));
	console.log(
		JSON.stringify({ url: page.url(), title: await page.title(), snapshot, verdict }, null, 2),
	);
} finally {
	await browser.close();
}
