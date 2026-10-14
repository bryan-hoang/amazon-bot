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
	pack: {
		entry: ["src/main.ts"],
		// playwright-core reads __dirname at load time, which ESM output lacks.
		format: "cjs",
		exe: { fileName: "amazon-bot", outDir: "dist" },
		deps: { alwaysBundle: ["playwright-core"], neverBundle: [/^chromium-bidi\//] },
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
