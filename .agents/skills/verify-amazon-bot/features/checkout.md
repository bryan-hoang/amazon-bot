# Buying (Dry Run)

## Sub-Features

- When Buy Now is available at or under the limit, the bot clicks it and
  finds "Place your order" in the quick-checkout panel or the full checkout
  page.
- When Amazon first asks to confirm a delivery address, the bot continues only
  if exactly one address is already selected, then clicks "Deliver to this
  address". It never picks a different address.
- A dry run stops there: `Test run worked: it reached the "Place your order"
  button at <price> and stopped. Nothing was bought.`
- A real order waits for a URL containing `thankyou`; otherwise it reports
  `unconfirmed` and exits 1.

## How to Get to It (User POV)

The user signs in once in the Edge window the bot opens, then leaves the bot running
until the item is in stock.

## Driving It with Browser Tests

Run the local browser fixture for the address-selection step. It mimics the
address selection, repeated delivery buttons, and review page shown above:

```sh
pnpm exec vp test --project browser -t "preselected delivery address"
```

Proof: the dry-run returns `test-stopped`, lands on the review page, and never
clicks the Place Order button. The sibling no-selection test proves the bot
stops instead of guessing an address.

## Live Amazon Checkout

An agent cannot verify a real signed-in checkout. It needs the user's Amazon
account, saved address and payment method, and an in-stock item at or under the
limit. Ask the user to run a dry run on their machine:

```sh
amazon-bot.exe --url <in-stock item> --max-price <above its price> --dry-run --timeout 10m
```

Proof: the bot reaches the live review page and prints its dry-run result with
exit code 0.

## Gotchas

- Never pass `--no-dry-run`. A real order charges the user's card.
- The address and Place Order selectors have only run against local fixture
  pages, not a live signed-in Amazon account.
