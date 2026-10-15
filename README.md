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
   - **Amazon product link**: it starts out as the Nintendo Switch 2 - The
     Legend of Zelda 40th Anniversary Edition on amazon.ca. For another
     product, copy the link from the address bar of its page.
   - **Highest price**: the bot never buys above this. This protects you from
     resellers charging too much. For the Zelda edition it starts out at 730
     CAD, a little above Nintendo's price of CAD 709.99. Another product has no
     starting price, so type one.
   - **Really buy it?**: type `no` for a test run. A test run goes all the way
     to the "Place your order" button and stops. Nothing is bought.
4. An Edge window opens. The first time, sign in to Amazon in that window. The
   bot remembers you after that.
5. Leave it running. It checks the page about every 15 seconds.

Do **one test run first**. When it works, run it again and type `yes`.

Next time, press Enter to keep your previous answers (shown in `[brackets]`).

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

`test/amazon.test.ts` holds the `unit` tests for price parsing, verdicts, and
store currencies.

`test/exe.test.ts` holds the `exe` tests. They run `vp pack`, copy the
executable to a temporary folder, and run it there the way the user does. Each
run gets its own `LOCALAPPDATA`, so your saved settings and Edge profile are
never touched. They check the options and error messages, answer the prompts
in a real terminal session, and confirm that a run started with flags alone
drives Edge. They need Edge and take about 15 seconds. They never place an
order.

### Git Hooks

The [`hk`](https://hk.jdx.dev) tool runs the checks from `hk.pkl`, and
`mise.toml` pins its version. Run `mise trust`, then `mise install`, then
`hk install` once per clone.

- Before each commit: `vp check` and the unit tests.
- Before each push: `vp check` and every test, including the executable tests.

To skip the hooks once, set `HK=0` for that Git command.
