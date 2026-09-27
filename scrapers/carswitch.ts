import type { CarListing, SearchFilters } from "../lib/types.js";
import { newContext, readJsonLd, hasType, sleep } from "../lib/browser.js";
import { toCarListing, type SchemaVehicle } from "../lib/jsonld.js";
import { matchesFilters, slugify } from "../lib/filters.js";

// Verified against the live site - see DEV_NOTES.md (re-verified 2026-09-27).
//
// CarSwitch server-renders an `ItemList` JSON-LD block of ~24 Product/Car entries
// per page (~2,300 cars in all). What the server actually filters on:
//  - /uae/used-cars/search?minprice=&maxprice=&minyear=&maxyear=&minmileage=&maxmileage=
//    - price/year/mileage ARE honoured server-side (lowercase names, from their JS).
//  - makes=<make>&models=<model> on /search is honoured together (and combines
//    with the ranges above) - but `makes` ALONE is ignored and returns every make.
//  - so a make-only search uses the make's own page, /uae/used-cars/<make>?page=N,
//    which filters by make but ignores the range params (applied locally instead).
//  - a few models are "series" on their side and use `model_series=` instead of
//    `models=` (list below, from their JS).
// Every listing is still re-checked by `matchesFilters` - an unrecognised slug is
// ignored rather than rejected and would otherwise leak the unfiltered list.

const ORIGIN = "https://carswitch.com";
const SEARCH = `${ORIGIN}/uae/used-cars/search`;
/** Server-filtered searches rarely need more; make-only pages (e.g. Nissan) run ~10. */
const MAX_PAGES = 10;
/** CarSwitch soft-blocks bursts (~15 hits in a couple of minutes) - space pages out. */
const PAGE_DELAY_MS = 2500;
const MODEL_SERIES = new Set(["5-series", "7-series", "land-cruiser", "patrol"]);

/** CarSwitch's own slugs differ from the everyday brand name for a few makes. */
const MAKE_SLUG_ALIASES: Record<string, string> = {
  "mercedes-benz": "mercedes",
  "mercedes-benz-amg": "mercedes",
  "land-rover": "range-rover",
  landrover: "range-rover",
  "rolls-royce": "rolls-royce",
};

function makeSlug(make: string): string {
  const slug = slugify(make);
  return MAKE_SLUG_ALIASES[slug] ?? slug;
}

function buildUrl(f: SearchFilters, pageNum: number): string {
  const params = new URLSearchParams();

  // Make without model: /search would ignore `makes`, so use the make's own page.
  if (f.make && !f.model) {
    if (pageNum > 1) params.set("page", String(pageNum));
    const query = params.toString();
    return `${ORIGIN}/uae/used-cars/${makeSlug(f.make)}${query ? `?${query}` : ""}`;
  }

  if (f.make && f.model) {
    const model = slugify(f.model);
    params.set("makes", makeSlug(f.make));
    params.set(MODEL_SERIES.has(model) ? "model_series" : "models", model);
  }
  // Ranges are filtered by CarSwitch itself on /search.
  if (f.minBudget !== undefined) params.set("minprice", String(f.minBudget));
  if (f.maxBudget !== undefined) params.set("maxprice", String(f.maxBudget));
  if (f.minYear !== undefined) params.set("minyear", String(f.minYear));
  if (f.maxYear !== undefined) params.set("maxyear", String(f.maxYear));
  if (f.minKm !== undefined) params.set("minmileage", String(f.minKm));
  if (f.maxKm !== undefined) params.set("maxmileage", String(f.maxKm));
  if (pageNum > 1) params.set("page", String(pageNum));

  const query = params.toString();
  return query ? `${SEARCH}?${query}` : SEARCH;
}

/** The search page carries one ItemList, whose entries wrap the car in `mainEntity`. */
function extractCars(blocks: unknown[]): SchemaVehicle[] {
  for (const block of blocks) {
    if (!hasType(block, "ItemList")) continue;
    const elements = (block as Record<string, any>).itemListElement;
    if (!Array.isArray(elements)) continue;
    const cars = elements
      .map((e: any) => e?.mainEntity)
      .filter((c: unknown): c is SchemaVehicle => !!c);
    if (cars.length > 0) return cars;
  }
  return [];
}

export async function scrapeCarSwitch(filters: SearchFilters): Promise<CarListing[]> {
  const ctx = await newContext();
  const page = await ctx.newPage();
  const listings: CarListing[] = [];

  try {
    const seen = new Set<string>();
    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      if (pageNum > 1) await sleep(PAGE_DELAY_MS);
      // The listing grid is server-rendered, so there is nothing to wait for.
      const cars = extractCars(await readJsonLd(page, buildUrl(filters, pageNum), 1500));
      if (cars.length === 0) break; // no ItemList past the last page of results
      // Past the last page some sites repeat the final page instead of going empty.
      const fresh = cars.filter((c) => {
        const key = JSON.stringify((c as Record<string, unknown>).url ?? (c as Record<string, unknown>).name ?? c);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (fresh.length === 0) break;

      for (const car of fresh) {
        const listing = toCarListing(car, "CarSwitch", ORIGIN, filters);
        if (listing && matchesFilters(listing, filters)) listings.push(listing);
      }
    }
  } finally {
    await ctx.close();
  }

  return listings;
}
