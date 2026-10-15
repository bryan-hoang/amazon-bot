# Agent Notes

`amazon-bot.exe` is a Windows tool for a nontechnical user: it watches one
Amazon product page and buys the item at or under a price limit. The
[README](README.md) covers usage and the build and check commands.

## Where Things Live

- `src/amazon.ts` holds every Amazon selector and page rule. After changing a
  selector, run `vp run probe <url>` against a live product page.
- `src/main.ts` holds the command-line options, prompts, saved settings, and
  the polling loop.
- The `pack` block in `vite.config.ts` builds the executable.

## Verify on the Executable

A passing `node src/main.ts` says nothing about the executable. It is a Node
single-executable app whose `require` loads only built-in modules, so a
dependency missing from `pack.deps.alwaysBundle` works under `node` and crashes
the executable. After changing dependencies, options, or startup code, run
`vp pack`, copy `dist/amazon-bot.exe` to a folder outside the repo, and run it
there.

- With piped standard input the bot has no terminal, so it needs `--url` and
  `--max-price` and asks nothing. Test the prompts in a real terminal session,
  such as one opened with `pywinpty`.
- Interactive runs rewrite `%LOCALAPPDATA%\amazon-bot\settings.json`. Back it
  up before the run and restore it after.
- After a run, stop the `msedge.exe` processes whose command line contains
  `amazon-bot\profile`.

## Money

Test with dry runs only: pass `--dry-run`, or answer `no` at the real-order
prompt. A real order charges the user's card, and an agent cannot undo it.
