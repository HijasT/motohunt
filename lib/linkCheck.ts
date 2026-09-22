import type { Page } from "playwright";
import { normLink } from "./adLink.js";
import { sleep } from "./browser.js";

export type LinkStatus = "ok" | "gone" | "unknown";
export type LinkCheckResult = { status: LinkStatus; detail: string };

/**
 * Page text that means the ad is over. Deliberately specific phrases only - a
 * bare "sold" appears in every site's nav/footer ("Sell car", "cars sold"...).
 * Verified: CarSwitch shows "We are sorry, this car is no longer available".
 */
const GONE_TEXT = [
  /no longer available/i,
  /this (car|ad|listing|vehicle) (has been|is|was) (sold|removed|deleted|expired)/i,
  /\b(ad|listing) (has )?expired\b/i,
];

/** Bot-protection interstitials: we learned nothing about the ad. */
const CHALLENGE_TITLE = /pardon our interruption|just a moment|access denied|attention required|are you a robot/i;

const isIdKey = (key: string) => key.startsWith("dubizzle:") || key.startsWith("carswitch:");
const isDubizzleShortLink = (link: string) => /^https?:\/\/(www\.)?dubizzle\.com\/s\//i.test(link);

/**
 * Loads one ad and classifies it. Only calls an ad "gone" on positive evidence
 * (404/410, bounced off the ad to some other page, or explicit "no longer
 * available"-style text); anything it can't read is "unknown", which the app
 * treats the same as "ok" - a flaky check must never tag a live car as sold.
 */
export async function checkAdLink(page: Page, link: string): Promise<LinkCheckResult> {
  let status: number | undefined;
  try {
    const res = await page.goto(link, { waitUntil: "domcontentloaded", timeout: 60000 });
    status = res?.status();
  } catch (e) {
    return { status: "unknown", detail: `load failed: ${(e as Error).message.split("\n")[0].slice(0, 120)}` };
  }

  if (status === 404 || status === 410) return { status: "gone", detail: `HTTP ${status}` };

  await sleep(4000); // client-side redirects and "sold" banners render after load

  const title = await page.title().catch(() => "");
  const body = (await page.evaluate(() => document.body?.innerText ?? "").catch(() => "")).replace(/\s+/g, " ");
  if (CHALLENGE_TITLE.test(title) || body.length < 400) {
    return { status: "unknown", detail: `blocked or empty page (${title.slice(0, 60) || "no title"})` };
  }

  // Short links always redirect; what matters is whether they landed on an ad.
  const finalKey = normLink(page.url());
  const expectedKey = normLink(link);
  if (isDubizzleShortLink(link)) {
    if (!finalKey.startsWith("dubizzle:")) return { status: "gone", detail: `short link no longer leads to an ad (${new URL(page.url()).pathname})` };
  } else if (finalKey !== expectedKey && (isIdKey(expectedKey) || !isIdKey(finalKey))) {
    return { status: "gone", detail: `redirected away from the ad to ${new URL(page.url()).pathname}` };
  }

  const phrase = GONE_TEXT.map((re) => body.match(re)?.[0]).find(Boolean);
  if (phrase) return { status: "gone", detail: `page says "${phrase}"` };

  if (status !== undefined && status >= 400) return { status: "unknown", detail: `HTTP ${status}` };
  return { status: "ok", detail: title.slice(0, 120) };
}

/** Dubizzle (Imperva) only serves real pages once the homepage challenge has resolved - see scrapers/dubizzle.ts. */
export async function warmUpDubizzle(page: Page): Promise<void> {
  await page.goto("https://uae.dubizzle.com/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await sleep(7000);
}
