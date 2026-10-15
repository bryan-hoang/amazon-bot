# Unattended Runs

## Sub-Features

- Without a terminal, or with `--no-input`, the bot uses flags and defaults and
  never asks.
- It prints `Watching <url>` and `Buying at <price> <currency> or less.`
- When Amazon needs a person (sign-in, typed CAPTCHA) and nobody is there, it
  stops with exit code 1 and says why, instead of waiting.
- `--timeout <duration>` ends the watch with exit code 2 and
  `Stopped after <n>s (--timeout) without buying anything.` It never cuts off
  a checkout in progress.

## How to Get to It (User POV)

A scheduled task or a script runs `amazon-bot.exe --no-input`.

## Driving It With `run-exe.ps1`

```sh
pwsh -File .agents/skills/verify-amazon-bot/scripts/run-exe.ps1 -Seconds 90 -- --no-input --dry-run --timeout 60s
```

Proof: `result.json` shows `exited: true` and no `killedAfterSeconds`.
`stdout.txt` shows the default link and `Buying at 730 CAD or less.` A fresh
profile is signed out, so the usual ending is exit code 1 with
`The bot's Edge profile is not signed in to Amazon` in `stderr.txt`. Exit code
2 with the timeout line means Amazon never loaded a page in time.

## Gotchas

- The scratch profile is never signed in, so an agent cannot reach the watch
  loop past sign-in. Reaching Buy Now needs the user's signed-in profile.
- Edge needs a few seconds to start; keep `--timeout` at 30 seconds or more.
