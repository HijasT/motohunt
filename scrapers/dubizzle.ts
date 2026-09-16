import type { Page } from "playwright";
import type { CarListing, SearchFilters } from "../lib/types.js";
import { newContext, readJsonLd, hasType, sleep } from "../lib/browser.js";
import { toCarListing, type SchemaVehicle } from "../lib/jsonld.js";
import { matchesFilters, slugify } from "../lib/filters.js";

// Verified against the live site - see DEV_NOTES.md.
//
// Two things matter here:
//  1. Dubizzle is behind Imperva. A cold hit on a search URL returns a 1KB
//     "Pardon Our Interruption" challenge page. Loading the homepage first lets
//     the challenge resolve and sets the cookie the rest of the session needs.
//  2. Each search page embeds a `SearchResultsPage` JSON-LD block whose
//     `mainEntity` is an ItemList of schema.org Vehicles - price, mileage, year,
//     brand, model and URL all included. That is what we read; no CSS selectors.

const ORIGIN = "https://uae.dubizzle.com";
const MAX_PAGES = 5; // ~26 listings per page

function buildUrl(f: SearchFilters, pageNum: number): string {
  // Make and model are path segments; an omitted make means "all used cars".
  const segments = ["motors", "used-cars"];
  if (f.make) segments.push(slugify(f.make));
  if (f.make && f.model) segments.push(slugify(f.model));

  const params = new URLSearchParams();
  if (f.maxBudget !== undefined) params.set("price__lte", String(f.maxBudget));
  if (f.maxKm !== undefined) params.set("kilometers__lte", String(f.maxKm));
  if (f.minYear !== undefined) params.set("year__gte", String(f.minYear));
  if (f.maxYear !== undefined) params.set("year__lte", String(f.maxYear));
  if (pageNum > 1) params.set("page", String(pageNum));

  const query = params.toString();
  return `${ORIGIN}/${segments.join("/")}/${query ? `?${query}` : ""}`;
}

/** Digs the Vehicle list out of the SearchResultsPage block, if the page has one. */
function extractVehicles(blocks: unknown[]): SchemaVehicle[] {
  for (const block of blocks) {
    if (!hasType(block, "SearchResultsPage")) continue;
    const mainEntity = (block as Record<string, any>).mainEntity;
    if (!hasType(mainEntity, "ItemList")) continue;
    const elements = mainEntity.itemListElement;
    if (!Array.isArray(elements)) continue;
    return elements.map((e: any) => e?.item).filter((v: unknown): v is SchemaVehicle => !!v);
  }
  return [];
}

/** Imperva serves the real page only after the homepage challenge has resolved. */
async function warmUp(page: Page): Promise<void> {
  await page.goto(ORIGIN, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(7000);
}

export async function scrapeDubizzle(filters: SearchFilters): Promise<CarListing[]> {
  const ctx = await newContext();
  const page = await ctx.newPage();
  const listings: CarListing[] = [];

  try {
    await warmUp(page);

    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      const vehicles = extractVehicles(await readJsonLd(page, buildUrl(filters, pageNum)));
      if (vehicles.length === 0) break; // past the last page, or challenged

      for (const v of vehicles) {
        const listing = toCarListing(v, "Dubizzle", ORIGIN, filters);
        if (listing && matchesFilters(listing, filters)) listings.push(listing);
      }

      if (pageNum < MAX_PAGES) await sleep(2000); // don't hammer
    }
  } finally {
    await ctx.close();
  }

  return listings;
}
