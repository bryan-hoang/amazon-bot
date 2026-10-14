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
3. Answer the questions:
   - **Amazon product link**: copy it from the address bar of the product page.
   - **Highest price**: the bot never buys above this. This protects you from
     resellers charging too much.
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

## Building

Needs Node 26 and `pnpm`. The toolchain is [Vite+](https://viteplus.dev); run it
as `pnpm exec vp`, or as `vp` with the global CLI.

```sh
vp install
vp check                      # format, lint, type check
vp test                       # unit tests
vp run probe <url>            # check selectors against a live page (headless Edge)
vp pack                       # writes dist/amazon-bot.exe
```

`vp pack` builds the executable from the `pack` block in `vite.config.ts`.
That block also inlines two JSON files playwright-core loads at runtime; if a
playwright update moves them, the build fails and names the fix.

All Amazon page knowledge (selectors, checkout) lives in `src/amazon.ts`. When
Amazon changes its pages, run the probe and fix the selectors there. The bot
never downloads browsers; it always uses the installed Edge.

Settings and the Edge profile are in `%LOCALAPPDATA%\amazon-bot`.
