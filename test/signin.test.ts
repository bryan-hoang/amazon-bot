import { chromium, type Browser, type Page } from "playwright-core";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { checkout, readSnapshot, signIn } from "../src/amazon.ts";

// A local fixture models an Amazon sign-in route: the store page, email page
// under /ap/, passkey page under /ax/, then the store with a signed-in account.
let signedIn = false;
const accountLink = () =>
	signedIn
		? '<div id="nav-link-accountList"><a href="/gp/css/homepage.html">Hello, Sam</a></div>'
		: '<div id="nav-link-accountList"><a href="/ap/signin?return=/dp/item">Sign in</a></div>';
const addressPage = (selected: boolean) => `<h1>Select a delivery address</h1>
<label><input type="radio" name="address"${selected ? " checked" : ""}>Selected address</label>
<label><input type="radio" name="address">Other address</label>
<label><input type="radio" name="address">Third address</label>
<button id="deliver-top" onclick="location.href='/checkout/review'">Deliver to this address</button>
<button id="deliver-bottom" onclick="location.href='/checkout/review'">Deliver to this address</button>`;
const pages = new Map<string, () => string>(
	Object.entries({
		"/dp/item": () => `${accountLink()}<h1>Item</h1>`,
		"/ap/signin": () =>
			'<form action="/ax/claim/webauthn"><input type="email" name="email"><button>Continue</button></form>',
		"/ax/claim/webauthn": () =>
			'<form action="/passkey-ok"><button id="passkey">Sign in with a passkey</button></form>',
		"/buy-now": () =>
			'<button id="buy-now-button" onclick="location.href=\'/checkout/address\'">Buy Now</button>',
		"/buy-now-no-selected-address": () =>
			'<button id="buy-now-button" onclick="location.href=\'/checkout/no-selected-address\'">Buy Now</button>',
		"/checkout/address": () => addressPage(true),
		"/checkout/no-selected-address": () => addressPage(false),
		"/checkout/review": () =>
			'<button id="placeOrder" onclick="document.body.dataset.orderSubmitted=\'true\'">Place your order</button>',
	}),
);

let server: Server;
let browser: Browser;
let base: string;

beforeAll(async () => {
	server = createServer((req, res) => {
		const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
		if (path === "/passkey-ok") {
			signedIn = true;
			res.writeHead(302, { location: "/dp/item" }).end();
			return;
		}
		const page = pages.get(path);
		res.writeHead(page ? 200 : 404, { "content-type": "text/html" }).end(page?.() ?? "");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (address === null || typeof address === "string") throw new Error("server has no port");
	base = `http://127.0.0.1:${address.port}`;
	browser = await chromium.launch({ channel: "msedge" });
});

afterAll(async () => {
	await browser?.close();
	server?.close();
});

async function openItem(): Promise<Page> {
	signedIn = false;
	const page = await browser.newPage();
	await page.goto(`${base}/dp/item`);
	return page;
}

test("waits through a passkey page outside /ap/ until the store shows the account", async () => {
	const page = await openItem();
	let returned = false;
	const done = signIn(page, () => {}, 30_000).then(() => (returned = true));

	await page.locator('input[name="email"]').fill("sam@example.com");
	await page.locator("button").click();
	await page.waitForURL(/\/ax\/claim\/webauthn/);
	// The person is still choosing their passkey; a URL outside /ap/ is not done.
	await page.waitForTimeout(2_500);
	expect(returned).toBe(false);

	await page.locator("#passkey").click();
	await done;
	expect(new URL(page.url()).pathname).toBe("/dp/item");
	expect((await readSnapshot(page)).signedIn).toBe(true);
});

test("gives up after waitMs when nobody finishes signing in", async () => {
	const page = await openItem();
	await expect(signIn(page, () => {}, 3_000)).rejects.toThrow("Timed out waiting for the sign-in.");
	expect(new URL(page.url()).pathname).toBe("/ap/signin");
});

test("confirms the preselected delivery address before stopping at Place Order", async () => {
	const page = await browser.newPage();
	try {
		await page.goto(`${base}/buy-now`);
		const result = await checkout(page, false, 2_000);
		expect(result).toEqual({ kind: "test-stopped" });
		expect(new URL(page.url()).pathname).toBe("/checkout/review");
		expect(
			await page.getByRole("button", { name: "Place your order", exact: true }).isVisible(),
		).toBe(true);
		expect(await page.locator("body").getAttribute("data-order-submitted")).toBeNull();
	} finally {
		await page.close();
	}
});

test("stops for user attention when no delivery address is selected", async () => {
	const page = await browser.newPage();
	try {
		await page.goto(`${base}/buy-now-no-selected-address`);
		const result = await checkout(page, false, 2_000);
		expect(result).toEqual({ kind: "checkout-not-found" });
		expect(new URL(page.url()).pathname).toBe("/checkout/no-selected-address");
		expect(await page.locator("#placeOrder").count()).toBe(0);
	} finally {
		await page.close();
	}
});
