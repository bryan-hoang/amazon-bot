import { spawn as spawnPty, type IPty } from "@lydell/node-pty";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import packageJson from "../package.json" with { type: "json" };

const root = join(import.meta.dirname, "..");
const URL_CA = "https://www.amazon.ca/dp/B014I8SSD0";
const DEFAULT_URL =
	"https://www.amazon.ca/Nintendo-Switch-Legend-Anniversary-Console/dp/B0F2TP12QL/ref=sr_1_2?sr=8-2";
let dir: string;
let exe: string;
let runs = 0;

// The exe runs from a folder outside the repo, the way the user runs it, so
// anything it can only find through the repo's node_modules fails here.
beforeAll(() => {
	execFileSync(process.execPath, [join(root, "node_modules/vite-plus/bin/vp"), "pack"], {
		cwd: root,
		stdio: "pipe",
	});
	dir = mkdtempSync(join(tmpdir(), "amazon-bot-exe-"));
	exe = join(dir, "amazon-bot.exe");
	copyFileSync(join(root, "dist/amazon-bot.exe"), exe);
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
});

// Each run gets its own LOCALAPPDATA, so the user's settings and Edge profile
// are never touched and runs cannot see each other's saved answers.
function appData(settings?: object): { env: NodeJS.ProcessEnv; settingsFile: string } {
	const localAppData = join(dir, `appdata-${++runs}`);
	const settingsFile = join(localAppData, "amazon-bot", "settings.json");
	mkdirSync(join(localAppData, "amazon-bot"), { recursive: true });
	if (settings) writeFileSync(settingsFile, JSON.stringify(settings));
	return { env: { ...process.env, LOCALAPPDATA: localAppData }, settingsFile };
}

function run(args: string[]) {
	const result = spawnSync(exe, args, { env: appData().env, input: "", encoding: "utf8" });
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Killing the whole tree also stops the Edge the bot launched.
function killTree(pid: number) {
	spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore" });
}

async function waitFor(read: () => string, pattern: RegExp, timeoutMs: number): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	while (!pattern.test(read())) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${pattern}:\n${read()}`);
		await sleep(100);
	}
	return read();
}

describe("arguments", () => {
	test("--version prints the package version", () => {
		expect(run(["--version"])).toEqual({
			status: 0,
			stdout: `${packageJson.version}\n`,
			stderr: "",
		});
	});

	test("-h lists every option", () => {
		const { status, stdout } = run(["-h"]);
		expect(status).toBe(0);
		for (const option of ["--url", "--max-price", "--dry-run", "--no-dry-run", "--no-input"]) {
			expect(stdout).toContain(option);
		}
		const help = stdout.replace(/\s+/g, " ");
		expect(help).toContain("CAD on amazon.ca");
		expect(help).toContain(DEFAULT_URL);
		expect(help).toContain("default: 730 for the default --url");
	});

	test.each([
		[["--max-price", "abc"], "Please type a price, for example 49.99"],
		[["--url", "https://example.com/x"], "That does not look like an Amazon link"],
		[["--bogus"], "unknown option '--bogus'"],
		[["--url", URL_CA], "--max-price is required with a --url other than the default"],
		[
			["--no-input", "--url", URL_CA],
			"--max-price is required with a --url other than the default",
		],
	])("%j fails with a message", (args, message) => {
		const { status, stdout, stderr } = run(args);
		expect(status).toBe(1);
		expect(stdout).toBe("");
		expect(stderr).toContain(message);
	});

	test("with no terminal, the defaults drive Edge and the run ends on its own", async () => {
		const { env, settingsFile } = appData();
		// A fresh profile is signed out, and nobody is there to sign in, so the bot
		// must stop by itself. --timeout covers a network that never loads a page.
		const child = spawn(exe, ["--timeout", "45s"], { env, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
		child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
		const status = await new Promise<number | null>((resolve) => child.on("exit", resolve)).finally(
			() => killTree(child.pid!),
		);
		expect(stdout).toContain(`Watching ${DEFAULT_URL}`);
		expect(stdout).toContain("Buying at 730 CAD or less.");
		expect(stdout).toContain("Test run: it will stop before paying.");
		expect(stdout).not.toContain("Amazon product link");
		expect(stdout).not.toContain("The bot waits for you");
		// Which ending depends on Amazon and the network, not on the bot.
		const ending =
			status === 1 && /not signed in|nobody is here/.test(stderr)
				? "needs a person"
				: status === 2 && stdout.includes("Stopped after 45s (--timeout)")
					? "timed out"
					: `unexpected exit ${status}:\n${stdout}\n${stderr}`;
		expect(["needs a person", "timed out"]).toContain(ending);
		expect(() => readFileSync(settingsFile)).toThrow();
	});
});

describe("prompts in a terminal", () => {
	function openTerminal(args: string[], settings?: object) {
		const { env, settingsFile } = appData(settings);
		const term: IPty = spawnPty(exe, args, { env, cols: 200, rows: 50 });
		let output = "";
		term.onData((data) => (output += data));
		const read = () => stripVTControlCharacters(output);
		const close = () => {
			killTree(term.pid);
			term.kill();
		};
		return { term, read, close, settingsFile };
	}

	test("asks only for settings not passed as flags, and saves only typed answers", async () => {
		const { term, read, close, settingsFile } = openTerminal(["--url", URL_CA, "--dry-run"]);
		try {
			await waitFor(read, /\(number only\)/, 15_000);
			term.write("7\r");
			await waitFor(read, /Opening Edge/, 15_000);
		} finally {
			close();
		}
		// The default price belongs to the default product, so another link has none.
		expect(read()).toContain("Highest price you will pay, in CAD (number only): ");
		expect(read()).not.toContain("Amazon product link");
		expect(read()).not.toContain("Really buy it");
		expect(read()).toContain("Test run: it will stop before paying.");
		expect(JSON.parse(readFileSync(settingsFile, "utf8"))).toEqual({
			placeOrder: false,
			maxPrice: 7,
		});
	});

	test("on a first run, Enter accepts the default product and price", async () => {
		const { term, read, close } = openTerminal([]);
		try {
			for (const prompt of [
				`Amazon product link [${DEFAULT_URL}]`,
				"in CAD (number only) [730]",
				"[no, test run]",
			]) {
				await waitFor(read, new RegExp(RegExp.escape(prompt)), 15_000);
				term.write("\r");
			}
			await waitFor(read, /Opening Edge/, 15_000);
		} finally {
			close();
		}
		expect(read()).toContain("Buying at 730 CAD or less.");
		expect(read()).toContain("Test run: it will stop before paying.");
	});

	test("--timeout also ends a wait for a person to sign in", async () => {
		const { term, read, close } = openTerminal(["--dry-run", "--timeout", "20s"]);
		const exitCode = new Promise<number>((resolve) => term.onExit((e) => resolve(e.exitCode)));
		try {
			await waitFor(read, /Amazon product link/, 15_000);
			term.write("\r");
			await waitFor(read, /\(number only\) \[730\]/, 15_000);
			term.write("\r");
			// A fresh profile is signed out, so the bot waits for a sign-in nobody
			// does, and --timeout has to end that wait.
			await waitFor(read, /Stopped after 20s \(--timeout\)/, 60_000);
			// The closing "Press Enter" pause still needs a key in a terminal.
			term.write("\r");
			expect(await exitCode).toBe(2);
		} finally {
			close();
		}
	});

	test("with no flags, asks every question and Enter keeps the saved answers", async () => {
		const saved = { url: URL_CA, maxPrice: 5, placeOrder: false };
		const { term, read, close } = openTerminal([], saved);
		try {
			for (const prompt of [
				`Amazon product link [${URL_CA}]`,
				"in CAD (number only) [5]",
				"[no, test run]",
			]) {
				await waitFor(read, new RegExp(RegExp.escape(prompt)), 15_000);
				term.write("\r");
			}
			await waitFor(read, /Opening Edge/, 15_000);
		} finally {
			close();
		}
		expect(read()).toContain("Test run: it will stop before paying.");
	});

	test.each([
		["https://www.amazon.com/dp/B014I8SSD0", "in USD (number only)"],
		["https://www.amazon.co.uk/dp/B014I8SSD0", "in the currency the product page shows"],
	])("the max price prompt for %s names its currency", async (url, expected) => {
		const { read, close } = openTerminal(["--url", url, "--dry-run"]);
		try {
			await waitFor(read, /\(number only\)/, 15_000);
		} finally {
			close();
		}
		expect(read()).toContain(expected);
	});
});
