import type { CarListing, SearchFilters } from "../lib/types.js";
import { lookupOrigin } from "../lib/originLookup.js";
import { matchesFilters, slugify, toNumber } from "../lib/filters.js";
import { findRecords } from "../lib/rscFlight.js";

// Verified against the live site - see DEV_NOTES.md.
//
// No bot protection and no schema.org JSON-LD either - the listing grid is
// server-rendered straight into the page, but the data travels in Next.js's
// internal RSC "Flight" wire format (see lib/rscFlight.ts) rather than a
// public contract. A plain `fetch` gets the full page; no browser needed.
//
// Only make/model are server-side filters (via the URL path); there's no URL
// form for price/km/year, so those are enforced locally by `matchesFilters`.
//
// Paging (re-verified 2026-09-27): `?page=N` IS server-rendered (20 cars a page,
// ~1,600 cars in all), and `?sort=plh` sorts price low -> high server-side and
// combines with it. So we walk price-sorted pages and stop as soon as a page
// starts above the max budget - a budget search reads only the pages that can
// match, not all ~80. Other sort codes from their JS: lhl (recently added),
// phl (price high-low), olh/ohl (km), alh/ahl (age).

const ORIGIN = "https://www.cars24.ae";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

/** Upper bound per search; a make-only search without a budget could otherwise walk dozens of pages. */
const MAX_PAGES = 15;
const PAGE_DELAY_MS = 1000;

function buildUrl(f: SearchFilters, pageNum: number): string {
  // Despite the "-dubai" suffix, this is Cars24's general UAE catalog - cars
  // listed in other emirates (confirmed: Sharjah) show up in it too. The
  // "-uae" suffixed variant exists but isn't server-rendered with data.
  const segments = ["buy-used"];
  if (f.make) segments.push(slugify(f.make));
  if (f.make && f.model) segments.push(slugify(f.model));
  segments.push("cars-dubai");
  const params = new URLSearchParams({ sort: "plh" }); // price low -> high, so we can stop early
  if (pageNum > 1) params.set("page", String(pageNum));
  return `${ORIGIN}/${segments.join("-")}/?${params}`;
}

type Car = {
  carName?: string;
  make?: string;
  model?: string;
  year?: number | string;
  fuelType?: string;
  cdpRelativeUrl?: string;
  appointmentId?: string;
  odometer?: { value?: number | string };
  // `listingPrice` occasionally comes back truncated - some payloads embed a
  // newline inside this value, which our RSC line-splitter mistakes for the
  // start of the next id. `listingPriceV2` carries the same number and has
  // never been seen truncated, so prefer it.
  listingPrice?: { value?: number | string };
  listingPriceV2?: { value?: number | string };
};

function toListing(car: Car, filters: SearchFilters): CarListing | null {
  const relativeUrl = car.cdpRelativeUrl;
  if (!relativeUrl) return null;

  const make = car.make ?? filters.make ?? "";
  return {
    source: "Cars24",
    make,
    model: car.model ?? filters.model ?? "",
    year: toNumber(car.year),
    price: toNumber(car.listingPriceV2?.value ?? car.listingPrice?.value),
    km: toNumber(car.odometer?.value),
    description: [car.carName, car.fuelType].filter(Boolean).join(" · "),
    link: `${ORIGIN}/${relativeUrl.replace(/^\/+/, "")}`,
    countryOfMake: lookupOrigin(make),
    scrapedAt: new Date().toISOString(),
  };
}

/** One retry on a network-level failure ("fetch failed" - dropped connection, DNS blip); HTTP errors aren't retried. */
async function fetchWithRetry(url: string): Promise<Response> {
  try {
    return await fetch(url, { headers: HEADERS });
  } catch {
    await new Promise((r) => setTimeout(r, 3000));
    return fetch(url, { headers: HEADERS });
  }
}

export async function scrapeCars24(filters: SearchFilters): Promise<CarListing[]> {
  const listings: CarListing[] = [];
  const seen = new Set<string>();

  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    if (pageNum > 1) await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    const res = await fetchWithRetry(buildUrl(filters, pageNum));
    if (!res.ok) {
      if (pageNum === 1) throw new Error(`Cars24 request failed: ${res.status}`);
      break; // a later page failing just ends the walk; keep what we have
    }

    const html = await res.text();
    // Past the last page the site may repeat cars rather than go empty - only new ones count.
    const cars = (findRecords(html, ["carName", "appointmentId"]) as Car[]).filter((c) => {
      const id = String(c.appointmentId ?? c.cdpRelativeUrl ?? "");
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (cars.length === 0) break;

    for (const car of cars) {
      const listing = toListing(car, filters);
      if (listing && matchesFilters(listing, filters)) listings.push(listing);
    }

    // Pages are price-sorted: once the cheapest car on a page is over budget, nothing later can match.
    const prices = cars
      .map((c) => toNumber(c.listingPriceV2?.value ?? c.listingPrice?.value))
      .filter((n): n is number => n !== null);
    if (filters.maxBudget !== undefined && prices.length && Math.min(...prices) > filters.maxBudget) break;
  }
  return listings;
}
