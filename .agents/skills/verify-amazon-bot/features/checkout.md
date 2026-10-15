# Buying (Dry Run)

## Sub-Features

- When Buy Now is available at or under the limit, the bot clicks it and
  finds "Place your order" in the quick-checkout panel or the full checkout
  page.
- A dry run stops there: `Test run worked: it reached the "Place your order"
  button at <price> and stopped. Nothing was bought.`
- A real order waits for a URL containing `thankyou`; otherwise it reports
  `unconfirmed` and exits 1.

## How to Get to It (User POV)

The user signs in once in the Edge window the bot opens, then leaves the bot running
until the item is in stock.

## Driving It: Ask the User

An agent cannot drive this journey. It needs a signed-in Amazon account with a
default address and payment method, and an in-stock item at or under the
limit. Ask the user to run it on their machine:

```sh
amazon-bot.exe --url <in-stock item> --max-price <above its price> --dry-run --timeout 10m
```

Proof: the dry-run line above and exit code 0.

## Gotchas

- Never pass `--no-dry-run`. A real order charges the user's card.
- The checkout selectors have never run against a live signed-in session; treat
  a first real dry run as the test of `SEL.turboButton` and `SEL.placeOrder`.
