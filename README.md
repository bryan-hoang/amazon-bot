# Amazon Restock Bot

Watches an Amazon product page and buys it the moment it comes back in stock
at or under your price.

## Before You Start

- **This breaks Amazon's Conditions of Use.** Amazon does not allow automated
  buying. Amazon can cancel the order or close your account. Use it at your own
  risk.
- Your Amazon account needs a **default delivery address and payment method**.
  The bot uses the Buy Now button, which only works when those are set.
- You need Microsoft Edge (it comes with Windows).

## Use It

1. Download `amazon-bot.exe`.
2. Double-click it. Windows may say "Windows protected your PC" because the
   program is not signed. Click **More info**, then **Run anyway**.
3. Answer the questions. Press Enter to accept the answer in `[brackets]`.
   Type `reset` in any letter case at any question to clear the saved answers
   and exit before Edge opens. Your Amazon sign-in profile remains. Close other
   bot windows that are still at setup, since they can save old answers after a
   reset. A reset does not stop a bot that is already watching.
   - **Amazon product link**: it starts out as the Nintendo Switch 2 - The
     Legend of Zelda 40th Anniversary Edition on amazon.ca. For another
     product, copy the link from the address bar of its page.
   - **Highest price**: the bot never buys above this. This protects you from
     resellers charging too much. For the Zelda edition it starts out at 730
     CAD, a little above Nintendo's price of CAD 709.99. Another product has no
     starting price, so type one.
   - **Really buy it?**: type `no` for a test run. A test run goes all the way
     to the "Place your order" button and stops. Nothing is bought.
4. An Edge window opens. The first time, sign in to Amazon in that window, with
   a password, passkey, or code, whichever Amazon asks for. Take your time: the
   bot carries on once Amazon shows you signed in, and remembers you after
   that.
   If checkout asks for a delivery address, the bot continues with the address
   already selected. If none is selected, it stops for you to review Edge.
5. Leave it running. It checks the page about every 15 seconds.

Do **one test run first**. When it works, run it again and type `yes`.

Next time, press Enter to keep your previous answers, shown as `[saved: ...]`.
Built-in values appear as `[default: ...]`. Enter keeps either value without
adding it as a new saved answer. An existing saved answer stays in the file.

Keep your PC awake: change the sleep setting to "Never" while the bot runs. To
stop the bot, close the Edge window.

If Amazon asks you to type some characters, the bot beeps. Type them in the
Edge window and the bot continues.

## Command Line

You can skip the questions by passing the answers as options. Run
`amazon-bot --help` for the full list.

```sh
amazon-bot --url https://www.amazon.ca/dp/B014I8SSD0 --max-price 10 --dry-run
```

`--max-price` is in the store's currency: CAD on amazon.ca, USD on
amazon.com.

Without a terminal, or with `--no-input`, the bot never asks. It uses the
defaults listed by `--help`, and it does a dry run unless you pass
`--no-dry-run`. The default price of 730 CAD applies only to the default
product, so `--max-price` is required with any other `--url`. If Amazon needs
a person, for a sign-in or a typed CAPTCHA, the bot stops with a message
instead of waiting, so sign in once from a terminal or by double-clicking the
bot first.

`--timeout <duration>` stops watching after that long, for example `30m` or
`2h`. Without it the bot watches until it buys or you close the Edge window.

| Exit code | Meaning                                                      |
| --------- | ------------------------------------------------------------ |
| 0         | An order was placed, or a dry run reached "Place your order" |
| 1         | An error, an unconfirmed order, or Amazon needs a person     |
| 2         | `--timeout` ran out before the bot bought anything           |

The default product and price are `DEFAULT_URL` and `DEFAULT_MAX_PRICE` in
`src/main.ts`.

## Building

Needs Windows, Microsoft Edge, Node 26, and `pnpm`. The toolchain is
[Vite+](https://viteplus.dev); run it as `pnpm exec vp`, or as `vp` with the
global CLI.

```sh
vp install
vp check                      # format, lint, type check
vp test                       # all tests: unit, then the built executable
vp test --project unit        # unit tests only, under a second
vp run probe --help           # check selectors against a live page
vp pack                       # writes dist/amazon-bot.exe
```

Both the bot and the probe parse their options with
[Commander](https://github.com/tj/commander.js), which also writes their
`--help` text.

`vp pack` builds the executable from the `pack` block in `vite.config.ts`.
That block also inlines two JSON files playwright-core loads at runtime; if a
playwright update moves them, the build fails and names the fix.

All Amazon page knowledge (selectors, checkout) lives in `src/amazon.ts`. When
Amazon changes its pages, run the probe and fix the selectors there. The bot
never downloads browsers; it always uses the installed Edge.

Settings and the Edge profile are in `%LOCALAPPDATA%\amazon-bot`.

### Tests

`test/amazon.test.ts` and `test/duration.test.ts` hold the `unit` tests for
price parsing, verdicts, store currencies, and `--timeout` values.

`test/signin.test.ts` holds the `browser` tests. They drive headless Edge
through local stand-in pages that follow Amazon's passkey sign-in route, and
check that the bot waits until the store shows the account as signed in. They
need Edge but not the network.

`test/exe.test.ts` holds the `exe` tests. They run `vp pack`, copy the
executable to a temporary folder, and run it there the way the user does. Each
run gets its own `LOCALAPPDATA`, so your saved settings and Edge profile are
never touched. They check the options and error messages, answer the prompts
in a real terminal session, and confirm that a run started with flags alone
drives Edge. They need Edge and take about 15 seconds. They never place an
order.

### Git Hooks

The [`hk`](https://hk.jdx.dev) tool runs the checks from `hk.pkl`. `mise.toml`
pins `hk`, `pnpm`, `jactionlint`, and `shellcheck`. `.node-version` pins Node.
Run `mise trust` and `mise trust .node-version`, then `mise install` and
`hk install` once per clone. Run `mise install` again after changing a version
file or `mise.toml`. Run `hk install` again after adding or changing a Git hook.

- Before each commit, `pre-commit` runs `vp check`, the unit tests, and
  `jactionlint` on staged workflow files.
- The local `commit-msg` hook checks commit messages. CI checks PR titles and
  non-merge commits in pull requests and pushes to `main`, including
  GitHub-created commits.
- Before each push, `pre-push` runs `vp check` and every test. It also runs
  `jactionlint` for workflow files changed by the push.

To skip the hooks once, set `HK=0` for that Git command.

### CI and Releases

Run `mise exec -- pnpm install --frozen-lockfile`, then
`mise exec -- hk check --all --slow` to run the project checks locally.

On a push to `main`, Release Please opens or updates a release PR. After you
merge it, the workflow builds and tests the Windows executable from the release
commit, adds it to a draft release, then publishes the release.

For transient build or upload failures, use GitHub Actions to rerun only the
failed jobs. A full workflow rerun will not resume an existing draft. If a code
fix is needed, resolve the old draft and tag before the next release.

To use `GITHUB_TOKEN` for Release Please, enable **Allow GitHub Actions to
create and approve pull requests** in the repository settings. GitHub does not
start workflows for pull requests created with `GITHUB_TOKEN`. Set a
`RELEASE_PLEASE_TOKEN` Actions secret if branch protection requires CI checks
on the release PR.
