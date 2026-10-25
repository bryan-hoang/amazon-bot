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
	execFileSync(process.execPath, [join(root, "node_modules/vite-plus/bin/vp"), "run", "build"], {
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
function appData(settings?: object): {
	env: NodeJS.ProcessEnv;
	settingsFile: string;
	profileDir: string;
} {
	const localAppData = join(dir, `appdata-${++runs}`);
	const home = join(localAppData, "amazon-bot");
	const settingsFile = join(home, "settings.json");
	const profileDir = join(home, "profile");
	mkdirSync(home, { recursive: true });
	if (settings) writeFileSync(settingsFile, JSON.stringify(settings));
	return { env: { ...process.env, LOCALAPPDATA: localAppData }, settingsFile, profileDir };
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
		expect(help).toContain("Saved answers show as [saved: ...].");
		expect(help).toContain("Built-in values show as [default: ...].");
		expect(help).toContain("Type reset at any question to clear saved answers and exit.");
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

describe("verification wrapper", () => {
	test("rejects real-order mode before running the executable", () => {
		const runner = join(root, ".agents/skills/verify-amazon-bot/scripts/run-exe.ps1");
		const result = spawnSync(
			"pwsh",
			["-NoProfile", "-File", runner, "-NoBuild", "--", "--no-dry-run"],
			{ cwd: root, encoding: "utf8" },
		);
		expect(result.status).toBe(1);
		expect(`${result.stderr}${result.stdout}`).toContain("refuses --no-dry-run");
	}, 15_000);
});

describe("commit message enforcement", () => {
	const checker = join(root, "scripts/check-conventional-commits.ps1");
	const check = (baseRef: string, headRef: string, title: string) => {
		const baseSha = execFileSync("git", ["rev-parse", baseRef], {
			cwd: root,
			encoding: "utf8",
		}).trim();
		const headSha = execFileSync("git", ["rev-parse", headRef], {
			cwd: root,
			encoding: "utf8",
		}).trim();
		return spawnSync(
			"pwsh",
			[
				"-NoProfile",
				"-File",
				checker,
				"-BaseSha",
				baseSha,
				"-HeadSha",
				headSha,
				"-PullRequestTitle",
				title,
			],
			{ cwd: root, encoding: "utf8" },
		);
	};

	test("rejects a historical non-Conventional commit", () => {
		const result = check("3db54c9^", "3db54c9", "ci: validate the PR title");
		expect(result.status).not.toBe(0);
		expect(`${result.stdout}${result.stderr}`).toContain("Invalid commit type");
	}, 15_000);

	test("accepts a Conventional commit and PR title", () => {
		const result = check(
			"95d2b9743eae7ef2653b6d70f863237694490567^",
			"95d2b9743eae7ef2653b6d70f863237694490567",
			"ci: validate commit messages",
		);
		expect(result.status).toBe(0);
	}, 15_000);

	test("rejects a non-Conventional PR title", () => {
		const result = check(
			"95d2b9743eae7ef2653b6d70f863237694490567^",
			"95d2b9743eae7ef2653b6d70f863237694490567",
			"Add commit message validation",
		);
		expect(result.status).not.toBe(0);
		expect(`${result.stdout}${result.stderr}`).toContain("Invalid commit type");
	}, 15_000);
});

describe("prompts in a terminal", () => {
	function openTerminal(args: string[], settings?: object) {
		const { env, settingsFile, profileDir } = appData(settings);
		const term: IPty = spawnPty(exe, args, { env, cols: 200, rows: 50 });
		let output = "";
		term.onData((data) => (output += data));
		const read = () => stripVTControlCharacters(output);
		const close = () => {
			killTree(term.pid);
			term.kill();
		};
		return { term, read, close, settingsFile, profileDir };
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
			maxPrice: 7,
		});
	});

	test("on a first run, Enter accepts the default product and price", async () => {
		const { term, read, close, settingsFile } = openTerminal([]);
		try {
			for (const prompt of [
				`Amazon product link [default: ${DEFAULT_URL}]`,
				"in CAD (number only) [default: 730]",
				"[default: no, test run]",
			]) {
				await waitFor(read, new RegExp(RegExp.escape(prompt)), 15_000);
				term.write("\r");
			}
			await waitFor(read, /Opening Edge/, 15_000);
		} finally {
			close();
		}
		expect(read()).toContain("Type reset at any question to clear saved answers and exit.");
		expect(read()).toContain("Buying at 730 CAD or less.");
		expect(read()).toContain("Test run: it will stop before paying.");
		expect(() => readFileSync(settingsFile)).toThrow();
	});

	test("--timeout also ends a wait for a person to sign in", async () => {
		const { term, read, close } = openTerminal(["--dry-run", "--timeout", "20s"]);
		const exitCode = new Promise<number>((resolve) => term.onExit((e) => resolve(e.exitCode)));
		try {
			await waitFor(read, /Amazon product link/, 15_000);
			term.write("\r");
			await waitFor(read, /\(number only\) \[default: 730\]/, 15_000);
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
		const { term, read, close, settingsFile } = openTerminal([], saved);
		try {
			for (const prompt of [
				`Amazon product link [saved: ${URL_CA}]`,
				"in CAD (number only) [saved: 5]",
				"[saved: no, test run]",
			]) {
				await waitFor(read, new RegExp(RegExp.escape(prompt)), 15_000);
				term.write("\r");
			}
			await waitFor(read, /Opening Edge/, 15_000);
		} finally {
			close();
		}
		expect(read()).toContain("Test run: it will stop before paying.");
		expect(JSON.parse(readFileSync(settingsFile, "utf8"))).toEqual(saved);
	});

	test("reset at the saved real-order prompt clears answers but keeps the profile", async () => {
		const saved = { url: URL_CA, maxPrice: 5, placeOrder: true };
		const { term, read, close, settingsFile, profileDir } = openTerminal([], saved);
		mkdirSync(profileDir, { recursive: true });
		const marker = join(profileDir, "keep-me.txt");
		writeFileSync(marker, "signed-in profile");
		const exitCode = new Promise<number>((resolve) =>
			term.onExit((event) => resolve(event.exitCode)),
		);
		try {
			for (const prompt of [
				`Amazon product link [saved: ${URL_CA}]`,
				"in CAD (number only) [saved: 5]",
			]) {
				await waitFor(read, new RegExp(RegExp.escape(prompt)), 15_000);
				term.write("\r");
			}
			await waitFor(read, /\[saved: YES, PLACE A REAL ORDER\]/, 15_000);
			term.write("ReSeT\r");
			await waitFor(
				read,
				/Saved answers were cleared\. Run again to use the built-in defaults\. Your Amazon sign-in profile remains\./,
				15_000,
			);
			await waitFor(read, /Press Enter to close\./, 15_000);
			term.write("\r");
			expect(await exitCode).toBe(0);
		} finally {
			close();
		}
		expect(() => readFileSync(settingsFile)).toThrow();
		expect(readFileSync(marker, "utf8")).toBe("signed-in profile");
		expect(read()).not.toContain("Opening Edge");
		expect(read()).toContain("Press Enter to close.");
	});

	test("reset exits successfully when no settings file exists", async () => {
		const { term, read, close, settingsFile } = openTerminal([]);
		const exitCode = new Promise<number>((resolve) =>
			term.onExit((event) => resolve(event.exitCode)),
		);
		try {
			await waitFor(
				read,
				new RegExp(RegExp.escape(`Amazon product link [default: ${DEFAULT_URL}]`)),
				15_000,
			);
			term.write("reset\r");
			await waitFor(
				read,
				/Saved answers were cleared\. Run again to use the built-in defaults\. Your Amazon sign-in profile remains\./,
				15_000,
			);
			await waitFor(read, /Press Enter to close\./, 15_000);
			term.write("\r");
			expect(await exitCode).toBe(0);
		} finally {
			close();
		}
		expect(() => readFileSync(settingsFile)).toThrow();
		expect(read()).not.toContain("Opening Edge");
	});

	test("an invalid saved real-order answer is labeled as a default", async () => {
		const { term, read, close, settingsFile } = openTerminal(
			["--url", URL_CA, "--max-price", "5"],
			{ placeOrder: "yes" },
		);
		const exitCode = new Promise<number>((resolve) =>
			term.onExit((event) => resolve(event.exitCode)),
		);
		try {
			await waitFor(read, /\[default: no, test run\]/, 15_000);
			term.write("reset\r");
			await waitFor(
				read,
				/Saved answers were cleared\. Run again to use the built-in defaults\. Your Amazon sign-in profile remains\./,
				15_000,
			);
			await waitFor(read, /Press Enter to close\./, 15_000);
			term.write("\r");
			expect(await exitCode).toBe(0);
		} finally {
			close();
		}
		expect(() => readFileSync(settingsFile)).toThrow();
		expect(read()).not.toContain("Opening Edge");
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
