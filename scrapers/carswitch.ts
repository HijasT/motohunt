import type { CarListing, SearchFilters } from "../lib/types.js";
import { newContext, readJsonLd, hasType } from "../lib/browser.js";
import { toCarListing, type SchemaVehicle } from "../lib/jsonld.js";
import { matchesFilters, slugify } from "../lib/filters.js";

// Verified against the live site - see DEV_NOTES.md.
//
// CarSwitch server-renders an `ItemList` JSON-LD block of ~24 Product/Car entries
// per page. Only `makes` and `models` are honoured as query params (plural - the
// singular forms are silently ignored); price/km/year have no param we could find,
// so those are applied by `matchesFilters` after the fact.
//
// An unrecognised make/model slug is ignored rather than rejected, and the site
// returns its *unfiltered* list - which is exactly why every listing is re-checked
// against the filters before it is returned.

const ORIGIN = "https://carswitch.com";
const SEARCH = `${ORIGIN}/uae/used-cars/search`;
const MAX_PAGES = 5;

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
  if (f.make) params.set("makes", makeSlug(f.make));
  if (f.model) params.set("models", slugify(f.model));
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
    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      // The listing grid is server-rendered, so there is nothing to wait for.
      const cars = extractCars(await readJsonLd(page, buildUrl(filters, pageNum), 1500));
      if (cars.length === 0) break; // no ItemList past the last page of results

      for (const car of cars) {
        const listing = toCarListing(car, "CarSwitch", ORIGIN, filters);
        if (listing && matchesFilters(listing, filters)) listings.push(listing);
      }
    }
  } finally {
    await ctx.close();
  }

  return listings;
}
