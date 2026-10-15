# Reading a Live Product Page

## Sub-Features

- `scripts/probe.ts` opens a URL in headless Edge and prints the page state
  the bot reads (`captcha`, `signedIn`, `buyNow`, `priceText`) and the
  verdict, as JSON.

## How to Get to It (User POV)

Maintainers run it after Amazon changes its pages, or after editing selectors
in `src/amazon.ts`.

## Driving It With `vp run probe`

```sh
pnpm exec vp run probe https://www.amazon.ca/dp/B014I8SSD0 --max-price 10
```

Proof: the JSON `title` names the product, and for an in-stock item `buyNow`
is `true` and `priceText` matches the price on the page. `verdict.kind` is
`signed-out` because the probe uses a fresh profile.

## Gotchas

- Headless Edge exits with the script; the probe needs no `--timeout`.
- The default product (the Nintendo Switch 2 link) shows no Buy Now button or
  price until it goes on sale. Use an in-stock item to check the price selectors.
- Prices depend on the delivery country: amazon.com showed `CAD` prices to a
  Canadian address.
