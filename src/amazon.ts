import type { Page } from "playwright-core";

export type Snapshot = {
	captcha: boolean;
	signedIn: boolean;
	buyNow: boolean;
	priceText: string | null;
};

export type Verdict =
	| { kind: "captcha" }
	| { kind: "signed-out" }
	| { kind: "unavailable" }
	| { kind: "no-price" }
	| { kind: "too-expensive"; price: number }
	| { kind: "buy"; price: number };

export type CheckoutResult =
	| { kind: "checkout-not-found" }
	| { kind: "test-stopped" }
	| { kind: "ordered" }
	| { kind: "unconfirmed" };

const SEL = {
	captcha: 'form[action*="validateCaptcha"]',
	captchaInput: "#captchacharacters",
	captchaSubmit: 'button[type="submit"], input[type="submit"]',
	account: "a#nav-link-accountList, #nav-link-accountList a",
	stayOnSite: "#redir-stay-at-www",
	buyNow: "#buy-now-button",
	prices: [
		"#corePrice_feature_div .a-offscreen",
		"#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen",
		// Amazon sometimes leaves .a-offscreen blank and only fills the visible digits.
		'#corePriceDisplay_desktop_feature_div .priceToPay [aria-hidden="true"]',
		"#apex_desktop .a-price .a-offscreen",
		"#price_inside_buybox",
		"#tp_price_block_total_price_ww .a-offscreen",
	],
	turboFrame: "#turbo-checkout-iframe",
	turboButton: "#turbo-checkout-pyo-button",
	placeOrder:
		'#placeOrder, input[name="placeYourOrder1"], #submitOrderButtonId input, #bottomSubmitOrderButtonId input',
};

const CHECKOUT_TIMEOUT = 30_000;
const CONFIRM_TIMEOUT = 60_000;

export async function readSnapshot(page: Page): Promise<Snapshot> {
	return page.evaluate((sel) => {
		const account = document.querySelector(sel.account);
		const buyNow = document.querySelector(sel.buyNow);
		const priceText =
			sel.prices
				.flatMap((s) => [...document.querySelectorAll(s)])
				.map((el) => (el.textContent ?? "").trim())
				.find(Boolean) ?? null;
		return {
			captcha: document.querySelector(sel.captcha) !== null,
			signedIn: account !== null && !(account.getAttribute("href") ?? "").includes("/ap/signin"),
			buyNow: buyNow !== null && !buyNow.matches(":disabled") && buyNow.checkVisibility(),
			priceText,
		};
	}, SEL);
}

export function parsePrice(text: string | null): number | null {
	const cleaned = (text ?? "").replace(/[^\d.,]/g, "");
	const last = Math.max(cleaned.lastIndexOf("."), cleaned.lastIndexOf(","));
	const decimal = last !== -1 && /^\d{1,2}$/.test(cleaned.slice(last + 1));
	const normalized = decimal
		? cleaned.slice(0, last).replace(/[.,]/g, "") + "." + cleaned.slice(last + 1)
		: cleaned.replace(/[.,]/g, "");
	if (!/\d/.test(normalized)) return null;
	const price = Number(normalized);
	return Number.isFinite(price) ? price : null;
}

export function judge(snapshot: Snapshot, maxPrice: number): Verdict {
	if (snapshot.captcha) return { kind: "captcha" };
	if (!snapshot.signedIn) return { kind: "signed-out" };
	if (!snapshot.buyNow) return { kind: "unavailable" };
	const price = parsePrice(snapshot.priceText);
	if (price === null) return { kind: "no-price" };
	return price <= maxPrice ? { kind: "buy", price } : { kind: "too-expensive", price };
}

// Visitors from another country get a "choose your Amazon website" overlay that
// swallows every click; keep the site the user's link points at.
export async function dismissOverlays(page: Page): Promise<void> {
	await page.addLocatorHandler(page.locator(SEL.stayOnSite), (stay) => stay.click());
}

// tellUser is called only when a human has to type the characters.
export async function handleCaptcha(page: Page, tellUser: () => void): Promise<void> {
	const form = page.locator(SEL.captcha);
	if ((await form.locator(SEL.captchaInput).count()) === 0) {
		await form.locator(SEL.captchaSubmit).first().click();
		await page.waitForLoadState("domcontentloaded");
		return;
	}
	tellUser();
	await form.waitFor({ state: "detached", timeout: 0 });
}

export async function signIn(page: Page, tellUser: () => void): Promise<void> {
	await page.locator(SEL.account).first().click();
	await page.waitForURL((url) => url.pathname.includes("/ap/"));
	tellUser();
	await page.waitForURL((url) => !url.pathname.includes("/ap/"), { timeout: 0 });
}

export async function checkout(page: Page, placeOrder: boolean): Promise<CheckoutResult> {
	await page.locator(SEL.buyNow).click();
	const turbo = page.frameLocator(SEL.turboFrame).locator(SEL.turboButton);
	const full = page.locator(SEL.placeOrder).filter({ visible: true }).first();
	const button = await Promise.any(
		[turbo, full].map((b) => b.waitFor({ timeout: CHECKOUT_TIMEOUT }).then(() => b)),
	).catch(() => null);
	if (button === null) return { kind: "checkout-not-found" };
	if (!placeOrder) return { kind: "test-stopped" };
	// Any failure from here on may still have submitted the order, so it must
	// never surface as a retryable error.
	try {
		await button.click();
		await page.waitForURL(/thankyou/, { timeout: CONFIRM_TIMEOUT });
		return { kind: "ordered" };
	} catch {
		return { kind: "unconfirmed" };
	}
}
