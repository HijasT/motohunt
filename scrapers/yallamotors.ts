import type { CarListing, SearchFilters } from "../lib/types.js";
import { newContext, readJsonLd, hasType, sleep } from "../lib/browser.js";
import { toCarListing, type SchemaVehicle } from "../lib/jsonld.js";
import { matchesFilters, slugify } from "../lib/filters.js";

// UNVERIFIED - the only scraper here not checked against the live site.
//
// yallamotors.com could not be reached from the machine this was written on:
// `uae.yallamotors.com` (the host the original handoff assumed) does not resolve
// at all, and the apex domain resolves to an origin server that answers 403 to
// everything, which looks like geo-restriction. See DEV_NOTES.md.
//
// So this is written to fail quietly rather than confidently produce junk:
//  - it tries several plausible URL shapes and keeps the first that yields cars;
//  - it reads schema.org JSON-LD (as the other three sites do) instead of CSS
//    selectors, so there is nothing brand-specific to guess at;
//  - every row still goes through `matchesFilters`, so a page that ignores our
//    query params can't leak non-matching cars into the sheet;
//  - if nothing matches any candidate, it returns [] and says so.
//
// To check it from a network that can reach the site: `npm run verify`.

const ORIGIN = "https://www.yallamotors.com";
const MAX_PAGES = 3;

/**
 * Candidate search URLs, most specific first. YallaMotors has moved its UAE used
 * car section between hosts and path prefixes over the years; whichever of these
 * responds with listings wins, and the rest are skipped.
 */
function candidateUrls(f: SearchFilters, pageNum: number): string[] {
  const make = f.make ? slugify(f.make) : "";
  const model = f.model ? slugify(f.model) : "";
  const path = ["used-cars", make, make && model ? model : ""].filter(Boolean).join("/");

  const params = new URLSearchParams();
  if (f.maxBudget !== undefined) params.set("max_price", String(f.maxBudget));
  if (f.maxKm !== undefined) params.set("max_mileage", String(f.maxKm));
  if (f.minYear !== undefined) params.set("min_year", String(f.minYear));
  if (f.maxYear !== undefined) params.set("max_year", String(f.maxYear));
  if (pageNum > 1) params.set("page", String(pageNum));
  const query = params.toString();
  const suffix = query ? `?${query}` : "";

  return [
    `${ORIGIN}/en-ae/${path}${suffix}`,
    `${ORIGIN}/uae/${path}${suffix}`,
    `https://uae.yallamotors.com/${path}${suffix}`,
  ];
}

/**
 * Permissive extractor: unlike the other sites we don't know which wrapper
 * YallaMotors uses, so accept any ItemList and take whichever of `item` /
 * `mainEntity` / the element itself carries a URL.
 */
function extractVehicles(blocks: unknown[]): SchemaVehicle[] {
  const found: SchemaVehicle[] = [];

  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const obj = node as Record<string, any>;

    if (hasType(obj, "ItemList") && Array.isArray(obj.itemListElement)) {
      for (const element of obj.itemListElement) {
        const car = element?.item ?? element?.mainEntity ?? element;
        if (car && typeof car === "object" && typeof car.url === "string") {
          found.push(car as SchemaVehicle);
        }
      }
    }
    // Some sites nest the list under `mainEntity`; follow the usual suspects.
    visit(obj.mainEntity);
    visit(obj["@graph"]);
  };

  blocks.forEach(visit);
  return found;
}

export async function scrapeYallaMotors(filters: SearchFilters): Promise<CarListing[]> {
  const ctx = await newContext();
  const page = await ctx.newPage();
  const listings: CarListing[] = [];

  let lastError: string | null = null;

  try {
    // Settle on a URL shape using page 1, then stay on it for the rest.
    let baseIndex = -1;

    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      const urls = candidateUrls(filters, pageNum);
      const toTry = baseIndex === -1 ? urls : [urls[baseIndex]];

      let vehicles: SchemaVehicle[] = [];
      for (const [i, url] of toTry.entries()) {
        try {
          vehicles = extractVehicles(await readJsonLd(page, url));
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err); // DNS failure, 403, timeout - try the next shape
          continue;
        }
        if (vehicles.length > 0) {
          if (baseIndex === -1) baseIndex = i;
          break;
        }
      }

      if (vehicles.length === 0) break;

      for (const v of vehicles) {
        const listing = toCarListing(v, "YallaMotors", ORIGIN, filters);
        if (listing && matchesFilters(listing, filters)) listings.push(listing);
      }

      if (pageNum < MAX_PAGES) await sleep(2000);
    }

    if (listings.length === 0) {
      console.warn(
        `YallaMotors: no listings found. This scraper is unverified - check the URL shapes in scrapers/yallamotors.ts against the live site.${
          lastError ? ` Last error: ${lastError.slice(0, 200)}` : ""
        }`
      );
    }
  } finally {
    await ctx.close();
  }

  return listings;
}
