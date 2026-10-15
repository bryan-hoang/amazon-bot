# Questions, Saved Answers, and Defaults

## Sub-Features

- With a terminal, the bot asks only for settings not passed as flags.
- `[brackets]` show the last typed answer, or the default: the Nintendo
  Switch 2 link, and `730` for that link only.
- The max price question names the store's currency (CAD on amazon.ca).
- Only typed answers are saved to `%LOCALAPPDATA%\amazon-bot\settings.json`.
- "Press Enter to close." at the end of a terminal run.

## How to Get to It (User POV)

Double-click `amazon-bot.exe`, or run it in a terminal without `--no-input`.

## Driving It With `vp test`

Prompts need a real terminal session; `run-exe.ps1` gives the bot none, so it
never asks. The executable tests open one with `@lydell/node-pty`, each with
its own `LOCALAPPDATA`:

```sh
pnpm exec vp test --project exe -t "prompts in a terminal"
```

Proof: the named tests pass. For a new prompt behavior, add a case to the
`prompts in a terminal` block in `test/exe.test.ts` that waits for the exact
question text and asserts the saved `settings.json`.

## Gotchas

- Each terminal test opens Edge after the questions; the test kills the tree.
  Pass `--timeout` in any new test that lets the watch loop run.
- Strip escape codes before matching output: `stripVTControlCharacters`.
