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
// Only make/model are confirmed as real server-side filters (via the URL
// path); no working price/km/year param was found, so those are enforced
// locally by `matchesFilters`, same as CarSwitch.
//
// Pagination beyond the first server-rendered batch (~15-40 cars) is a
// client-side "load more" fetch, not a `?page=` param - not implemented here.

const ORIGIN = "https://www.cars24.ae";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

function buildUrl(f: SearchFilters): string {
  // Despite the "-dubai" suffix, this is Cars24's general UAE catalog - cars
  // listed in other emirates (confirmed: Sharjah) show up in it too. The
  // "-uae" suffixed variant exists but isn't server-rendered with data.
  const segments = ["buy-used"];
  if (f.make) segments.push(slugify(f.make));
  if (f.make && f.model) segments.push(slugify(f.model));
  segments.push("cars-dubai");
  return `${ORIGIN}/${segments.join("-")}/`;
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

export async function scrapeCars24(filters: SearchFilters): Promise<CarListing[]> {
  const res = await fetch(buildUrl(filters), { headers: HEADERS });
  if (!res.ok) throw new Error(`Cars24 request failed: ${res.status}`);

  const html = await res.text();
  const cars = findRecords(html, ["carName", "appointmentId"]) as Car[];

  const listings: CarListing[] = [];
  for (const car of cars) {
    const listing = toListing(car, filters);
    if (listing && matchesFilters(listing, filters)) listings.push(listing);
  }
  return listings;
}
