import type { CarListing, SearchFilters } from "./types.js";
import { closeBrowser } from "./browser.js";
import { dedupeByLink } from "./filters.js";
import { scrapeDubizzle } from "../scrapers/dubizzle.js";
import { scrapeCarSwitch } from "../scrapers/carswitch.js";
import { scrapeAutoMall } from "../scrapers/automall.js";
import { scrapeYallaMotors } from "../scrapers/yallamotors.js";

export type Scraper = {
  name: string;
  run: (filters: SearchFilters) => Promise<CarListing[]>;
};

/**
 * Al Aweer Auto Market is deliberately absent: alaweerautomarket.com is still a
 * pre-launch waitlist page with no inventory on it (see DEV_NOTES.md).
 */
export const scrapers: Scraper[] = [
  { name: "Dubizzle", run: scrapeDubizzle },
  { name: "CarSwitch", run: scrapeCarSwitch },
  { name: "Al Futtaim Automall", run: scrapeAutoMall },
  { name: "YallaMotors", run: scrapeYallaMotors },
];

export type SourceResult =
  | { name: string; ok: true; listings: CarListing[] }
  | { name: string; ok: false; error: string };

export type SearchRun = {
  label: string;
  results: SourceResult[];
  listings: CarListing[];
};

/**
 * Scrapes every site for every given filter set, sharing one browser instance
 * across the whole batch (only closed once, at the end) rather than relaunching
 * Chromium per filter set. Filter sets run one at a time, not concurrently with
 * each other - CarSwitch soft-blocks on a burst of requests (see DEV_NOTES.md),
 * and running N saved searches at once would multiply the request rate against
 * every site by N for no benefit within a 6-hour cron cadence.
 */
export async function runScrapersForMany(
  searches: { label: string; filters: SearchFilters }[]
): Promise<SearchRun[]> {
  const runs: SearchRun[] = [];

  try {
    for (const search of searches) {
      const settled = await Promise.allSettled(scrapers.map((s) => s.run(search.filters)));

      const results: SourceResult[] = settled.map((outcome, i) => {
        const name = scrapers[i].name;
        return outcome.status === "fulfilled"
          ? { name, ok: true, listings: outcome.value }
          : { name, ok: false, error: String(outcome.reason?.message ?? outcome.reason) };
      });

      const listings = dedupeByLink(results.flatMap((r) => (r.ok ? r.listings : [])));
      runs.push({ label: search.label, results, listings });
    }
  } finally {
    await closeBrowser();
  }

  return runs;
}

/** Convenience wrapper for the common case of a single filter set (used by verify.ts). */
export async function runScrapers(filters: SearchFilters): Promise<{
  results: SourceResult[];
  listings: CarListing[];
}> {
  const [run] = await runScrapersForMany([{ label: "default", filters }]);
  return { results: run.results, listings: run.listings };
}

export function printSummary(results: SourceResult[], total: number): void {
  for (const r of results) {
    if (r.ok) {
      console.log(`  ${r.name.padEnd(22)} ${String(r.listings.length).padStart(4)} listings`);
    } else {
      console.error(`  ${r.name.padEnd(22)} FAILED: ${r.error}`);
    }
  }
  console.log(`Total after dedupe: ${total}`);
}
