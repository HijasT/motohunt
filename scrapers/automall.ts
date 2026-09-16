import type { CarListing, SearchFilters } from "../lib/types.js";
import { lookupOrigin } from "../lib/originLookup.js";
import { matchesFilters, toNumber } from "../lib/filters.js";

// Verified against the live site - see DEV_NOTES.md.
//
// Al-Futtaim Automall renders its listing grid client-side from its own public
// BFF API, so there is nothing useful in the HTML and no point driving a browser.
// We call the same two endpoints the site's own JavaScript calls:
//
//   GET /bff/dx/guest-access-token   -> { access_token }
//   GET /bff/v2/vehicles?q=...&fields=...   (Bearer token + `paging-info` header)
//
// Their whole used stock is a few hundred cars, so we pull the inventory in one
// request and filter locally. That avoids guessing at their query DSL for price,
// year and mileage, and it means a make we spell differently to them (they write
// "MERCEDESBENZ") still matches instead of silently returning nothing.

const ORIGIN = "https://www.automall.ae";
const PAGE_SIZE = 1000; // their API accepts up to 2000; stock is ~270

const QUERY = "type=auto_used_automobiles|price>0|attributes.auto_sap_vehicle_status.values.EN=AV";

const FIELDS = [
  "id",
  "price",
  "attributes.auto_sap_make.values.EN as make",
  "attributes.auto_sap_model.values.EN as model",
  "attributes.auto_sap_model_year.values.EN as modelYear",
  "attributes.auto_sap_odometer.values.EN as odometer",
  "attributes.auto_sap_model_grade.values.EN as modelGrade",
  "attributes.auto_sap_body_type.values.EN as bodyType",
  "attributes.auto_sap_transmission_type.values.EN as transmissionType",
  "attributes.auto_sap_engine_capacity.values.EN as engineCapacity",
  "attributes.auto_vehicle_location.values.EN as vehicleLocation",
].join("|");

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

type Vehicle = {
  id?: string;
  price?: number;
  make?: string;
  model?: string;
  modelYear?: string;
  odometer?: string;
  modelGrade?: string;
  bodyType?: string;
  transmissionType?: string;
  engineCapacity?: string;
  vehicleLocation?: string;
};

async function getGuestToken(): Promise<string> {
  const res = await fetch(`${ORIGIN}/bff/dx/guest-access-token`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Automall token request failed: ${res.status}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("Automall token response had no access_token");
  return body.access_token;
}

async function fetchInventory(token: string): Promise<Vehicle[]> {
  // `q` and `fields` use `|` and `>` as syntax, so they must not be percent-encoded.
  const url = `${ORIGIN}/bff/v2/vehicles?q=${QUERY}&fields=${FIELDS}&sort=price=1`;
  const res = await fetch(url, {
    headers: {
      ...HEADERS,
      authorization: `Bearer ${token}`,
      "paging-info": `start-index=0|no-of-records=${PAGE_SIZE}`,
    },
  });
  if (!res.ok) throw new Error(`Automall vehicles request failed: ${res.status}`);

  const paging = res.headers.get("paging-info") ?? "";
  const total = toNumber(paging.match(/total-count=(\d+)/)?.[1]);
  if (total !== null && total > PAGE_SIZE) {
    console.warn(`Automall: stock is ${total} cars but only ${PAGE_SIZE} were fetched - raise PAGE_SIZE.`);
  }

  const body = await res.json();
  return Array.isArray(body) ? (body as Vehicle[]) : [];
}

function toListing(v: Vehicle): CarListing | null {
  if (!v.id) return null; // the id is the VIN, and the detail page is keyed on it

  const make = v.make ?? "";
  const details = [v.modelGrade, v.engineCapacity, v.transmissionType, v.bodyType, v.vehicleLocation]
    .filter(Boolean)
    .join(" · ");

  return {
    source: "Al Futtaim Automall",
    make,
    model: v.model ?? "",
    year: toNumber(v.modelYear),
    price: toNumber(v.price),
    km: toNumber(v.odometer),
    description: details,
    link: `${ORIGIN}/en/used-cars-shop/${v.id}`,
    countryOfMake: lookupOrigin(make),
    scrapedAt: new Date().toISOString(),
  };
}

export async function scrapeAutoMall(filters: SearchFilters): Promise<CarListing[]> {
  const vehicles = await fetchInventory(await getGuestToken());

  const listings: CarListing[] = [];
  for (const v of vehicles) {
    const listing = toListing(v);
    if (listing && matchesFilters(listing, filters)) listings.push(listing);
  }
  return listings;
}
