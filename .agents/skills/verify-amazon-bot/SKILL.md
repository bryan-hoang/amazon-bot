---
name: verify-amazon-bot
description: Drive the packaged amazon-bot.exe (a Windows CLI that opens Edge) the way its user does and capture evidence, without stalling on an open browser. Use to prove a change to options, prompts, the watch loop, or Amazon selectors before calling it done.
---

# Verify the Amazon Bot

The user surface is `dist/amazon-bot.exe`: a console program that asks questions
(or takes flags), opens Edge with its own profile, and watches one Amazon page.
`node src/main.ts` is not the surface; the executable can fail where it passes.
Feature journeys live in the [feature map](features/README.md).

## Bounded Runs

Every run an agent starts ends by itself. A run with no deadline is a stall:
the bot is built to watch a page for days and to wait for a person to sign in.

- Start the executable only through `scripts/run-exe.ps1`. It kills the whole
  process tree, Edge included, after `-Seconds`.
- Pass `--no-input` and `--timeout`. With `--no-input` the bot stops with exit
  code 1 instead of waiting for a sign-in or a typed CAPTCHA, and `--timeout`
  ends the watch with exit code 2. Keep `--timeout` well under `-Seconds`.
- Run tests through `vp test`. Every executable test and hook has a deadline in
  `vite.config.ts`.

## Money

Pass `--dry-run`, or leave `--no-dry-run` out. A real order charges the user's
card and cannot be undone. A dry run still opens Edge and loads Amazon over the
network; it stops at the "Place your order" button.

## Doctor

Run first, and again whenever a run looks wrong:

```sh
pwsh -File .agents/skills/verify-amazon-bot/scripts/doctor.ps1
```

It checks Windows, Edge, Node 26, installed dependencies, that
`dist/amazon-bot.exe --version` matches `package.json`, and that the user's own
bot is not running. Exit code 1 means fix the failing line before driving.

## Launch and Drive

There is no server. Each drive builds and starts one isolated copy:

```sh
pwsh -File .agents/skills/verify-amazon-bot/scripts/run-exe.ps1 -Seconds 90 -- --no-input --dry-run --timeout 60s
```

Arguments after `--` go to the executable. `-NoBuild` skips `vp pack` when
`dist/amazon-bot.exe` is already current. The script prints a JSON result with
`exitCode`, `killedAfterSeconds`, and the evidence folder. A non-null
`killedAfterSeconds` means the bot ignored its own deadline: that is a bug.

Prompts need a terminal session, so drive them through the executable tests,
which use `@lydell/node-pty`:

```sh
pnpm exec vp test --project exe -t "<test name>"
```

## Evidence

`run-exe.ps1` writes `stdout.txt`, `stderr.txt`, `result.json`, and `pack.log`
to `%TEMP%\amazon-bot-evidence\<timestamp>\`. Cleanup never deletes that folder.
A proof quotes the command, the exit code, and the output lines that show the
behavior. For a settings change, also show the resulting `settings.json` (the
executable tests assert it in the run's temporary `LOCALAPPDATA`).

## Cleanup

`run-exe.ps1` kills the process tree it started and deletes its scratch folder.
The executable tests kill their own trees and delete their temporary folders.
After a failed or interrupted run, stop what verification started:

```sh
pwsh -File .agents/skills/verify-amazon-bot/scripts/cleanup.ps1
```

It stops only processes whose command line names an `amazon-bot-scratch-` or
`amazon-bot-exe-` folder, then deletes those folders. It never touches the
user's profile, `%LOCALAPPDATA%\amazon-bot\profile`, or the evidence folder.
