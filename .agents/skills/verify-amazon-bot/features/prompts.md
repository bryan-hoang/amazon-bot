# Questions, Saved Answers, and Defaults

## Sub-Features

- With a terminal, the bot asks only for settings not passed as flags.
- `[saved: ...]` shows a saved answer. `[default: ...]` shows a built-in
  fallback: the Nintendo Switch 2 link, and `730` for that link only.
- A saved real-order choice is shown as `[saved: YES, PLACE A REAL ORDER]`.
- The max price question names the store's currency (CAD on amazon.ca).
- Only typed answers are saved to `%LOCALAPPDATA%\amazon-bot\settings.json`.
- Pressing Enter accepts the bracketed value without saving it as a new answer.
  An existing saved answer stays in the file.
- Typing `reset` at any settings question, in any letter case, deletes only
  `settings.json` and exits before Edge opens. The Amazon sign-in profile remains.
- Close other setup copies before reset. A copy still at a prompt can save its
  in-memory answers after the reset.
- Reset does not stop a watcher that already resolved its settings.
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

Proof: the named tests pass. For a prompt behavior, add a case to the
`prompts in a terminal` block in `test/exe.test.ts` that waits for the exact
prompt text and checks the settings file and profile effects.

## Gotchas

- Each terminal test opens Edge after the questions; the test kills the tree.
  Pass `--timeout` in any new test that lets the watch loop run.
- Strip escape codes before matching output: `stripVTControlCharacters`.
