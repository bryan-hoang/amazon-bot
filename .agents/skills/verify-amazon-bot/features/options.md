# Command-Line Options

## Sub-Features

- `-h`, `--help`: options, the defaults block, and examples; exit code 0.
- `-V`, `--version`: the `package.json` version; exit code 0.
- Value checks for `--url`, `--max-price`, and `--timeout`, with the same
  messages the questions use; exit code 1.
- `--max-price` is required with a `--url` other than the default when the bot
  cannot ask.

## How to Get to It (User POV)

Run `amazon-bot.exe --help` in a terminal. A double-click passes no options.

## Driving It With `run-exe.ps1`

```sh
pwsh -File .agents/skills/verify-amazon-bot/scripts/run-exe.ps1 -Seconds 30 -- --help
pwsh -File .agents/skills/verify-amazon-bot/scripts/run-exe.ps1 -NoBuild -Seconds 30 -- --timeout soon
```

Proof: `--help` exits 0 and `stdout.txt` lists `--url`, `--max-price`,
`--dry-run`, `--no-dry-run`, `--no-input`, and `--timeout`, plus the
`Defaults:` block with the Nintendo Switch 2 link and `730`. The bad value
exits 1, and `stderr.txt` names the option and how to fix it.

## Gotchas

- Commander exits before any Edge window opens, so these runs take about a
  second. A run that opens Edge is a different feature.
- Help wraps long descriptions; compare text with whitespace collapsed.
