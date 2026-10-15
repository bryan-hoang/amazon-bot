import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defineConfig } from "vite-plus";

export default defineConfig({
	fmt: { useTabs: true },
	lint: {
		jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
		rules: { "vite-plus/prefer-vite-plus-imports": "error" },
		options: { typeAware: true, typeCheck: true },
	},
	test: {
		projects: [
			{ test: { name: "unit", include: ["test/amazon.test.ts"] } },
			// Builds the exe and launches Edge, so it is too slow for every commit.
			{ test: { name: "exe", include: ["test/exe.test.ts"] } },
		],
	},
	pack: {
		entry: ["src/main.ts"],
		// playwright-core reads __dirname at load time, which ESM output lacks.
		format: "cjs",
		exe: { fileName: "amazon-bot", outDir: "dist" },
		// The exe can only require Node built-ins, so every dependency is bundled.
		deps: { alwaysBundle: [/^[^.]/], neverBundle: [/^chromium-bidi\//] },
		plugins: [
			{
				// The exe's require() only loads builtins, so inline the JSON files
				// that playwright-core requires from its package root at runtime.
				name: "inline-playwright-json",
				transform(code, id) {
					if (!/playwright-core[\\/]lib[\\/]coreBundle\.js$/.test(id)) return;
					let n = 0;
					const out = code.replace(
						/require\(\w+\.default\.join\(packageRoot, "(\w+\.json)"\)\)/g,
						(_, file) => (n++, readFileSync(join(dirname(id), "..", file), "utf8")),
					);
					if (n !== 2) throw new Error(`expected 2 playwright-core json requires, found ${n}`);
					return out;
				},
			},
		],
	},
});
