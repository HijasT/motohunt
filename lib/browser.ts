import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

let browser: Browser | null = null;

/**
 * One Chromium instance shared by every scraper - launching one per site is slow
 * and pointless. `closeBrowser()` must be called once the run is finished.
 */
export async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      // Dubizzle sits behind Imperva, which checks for the usual automation tells.
      args: ["--disable-blink-features=AutomationControlled"],
    });
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  await browser?.close();
  browser = null;
}

/** A context that looks like an ordinary desktop browser rather than a bot. */
export async function newContext(): Promise<BrowserContext> {
  const ctx = await (await getBrowser()).newContext({
    userAgent: USER_AGENT,
    locale: "en-US",
    timezoneId: "Asia/Dubai",
    viewport: { width: 1366, height: 900 },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  return ctx;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Navigate and return every parsed `<script type="application/ld+json">` block.
 *
 * All four sites publish schema.org data for their listings, which is a far more
 * stable contract than CSS classes - it's there for Google, so the sites have a
 * reason to keep it working. Prefer it over scraping rendered markup.
 */
export async function readJsonLd(page: Page, url: string, settleMs = 5000): Promise<unknown[]> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(settleMs);

  const blocks = await page.$$eval('script[type="application/ld+json"]', (nodes) =>
    nodes.map((n) => n.textContent ?? "")
  );

  const parsed: unknown[] = [];
  for (const block of blocks) {
    try {
      parsed.push(JSON.parse(block));
    } catch {
      // A malformed block on the page shouldn't kill the whole scrape.
    }
  }
  return parsed;
}

/** Narrow a JSON-LD block by its `@type`, which sites write as either a string or an array. */
export function hasType(node: unknown, type: string): boolean {
  if (typeof node !== "object" || node === null) return false;
  const raw = (node as Record<string, unknown>)["@type"];
  return Array.isArray(raw) ? raw.includes(type) : raw === type;
}
