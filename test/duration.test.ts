import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { parseDuration } from "../src/duration.ts";

test("parseDuration reads seconds, minutes, and hours", () => {
	assert.equal(parseDuration("90s"), 90_000);
	assert.equal(parseDuration("15m"), 900_000);
	assert.equal(parseDuration("2h"), 7_200_000);
	assert.equal(parseDuration("1.5h"), 5_400_000);
	assert.equal(parseDuration(" 30s "), 30_000);
});

test("parseDuration rejects missing units, zero, and other text", () => {
	assert.equal(parseDuration("90"), null);
	assert.equal(parseDuration("0s"), null);
	assert.equal(parseDuration("-5m"), null);
	assert.equal(parseDuration("2d"), null);
	assert.equal(parseDuration("soon"), null);
});
