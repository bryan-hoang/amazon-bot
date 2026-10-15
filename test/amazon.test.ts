import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { currencyFor, parsePrice, judge, type Snapshot } from "../src/amazon.ts";

test("currencyFor names the store's currency", () => {
	assert.equal(currencyFor("https://www.amazon.ca/dp/B014I8SSD0"), "CAD");
	assert.equal(currencyFor("https://amazon.ca/dp/B014I8SSD0"), "CAD");
	assert.equal(currencyFor("https://www.amazon.com/dp/B014I8SSD0"), "USD");
	assert.equal(currencyFor("https://www.amazon.co.uk/dp/B014I8SSD0"), undefined);
	assert.equal(currencyFor("https://notamazon.ca/dp/B014I8SSD0"), undefined);
});

test("parsePrice handles locale formats", () => {
	assert.equal(parsePrice("$1,299.99"), 1299.99);
	assert.equal(parsePrice("1.299,99 €"), 1299.99);
	assert.equal(parsePrice("CDN$ 49.99"), 49.99);
	assert.equal(parsePrice("£5"), 5);
	assert.equal(parsePrice("¥12,800"), 12800);
	assert.equal(parsePrice("1.299"), 1299);
	assert.equal(parsePrice("$0.5"), 0.5);
	assert.equal(parsePrice(""), null);
	assert.equal(parsePrice(null), null);
	assert.equal(parsePrice("Currently unavailable"), null);
});

const ok: Snapshot = { captcha: false, signedIn: true, buyNow: true, priceText: "$49.99" };

test("judge verdicts", () => {
	assert.deepEqual(judge(ok, 50), { kind: "buy", price: 49.99 });
	assert.deepEqual(judge(ok, 49.99), { kind: "buy", price: 49.99 });
	assert.deepEqual(judge(ok, 49.98), { kind: "too-expensive", price: 49.99 });
	assert.deepEqual(judge({ ...ok, priceText: null }, 50), { kind: "no-price" });
	assert.deepEqual(judge({ ...ok, buyNow: false }, 50), { kind: "unavailable" });
	assert.deepEqual(judge({ ...ok, signedIn: false }, 50), { kind: "signed-out" });
	assert.deepEqual(judge({ ...ok, captcha: true }, 50), { kind: "captcha" });
});

test("judge checks in order: captcha, signed-out, unavailable, no-price", () => {
	const nothing = { captcha: true, signedIn: false, buyNow: false, priceText: null };
	assert.deepEqual(judge(nothing, 50), { kind: "captcha" });
	assert.deepEqual(judge({ ...nothing, captcha: false }, 50), { kind: "signed-out" });
	assert.deepEqual(judge({ ...nothing, captcha: false, signedIn: true }, 50), {
		kind: "unavailable",
	});
	assert.deepEqual(judge({ ...ok, signedIn: false, priceText: "$1" }, 50), { kind: "signed-out" });
});
