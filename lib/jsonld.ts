import type { CarListing, SearchFilters } from "./types.js";
import { lookupOrigin } from "./originLookup.js";
import { toNumber } from "./filters.js";

/**
 * The slice of schema.org Vehicle/Car that every one of these sites publishes.
 * Each site picks a slightly different wrapper around it (see the scrapers), but
 * the node itself is the same shape, so the mapping below is shared.
 */
export type SchemaVehicle = {
  url?: string;
  name?: string;
  description?: string;
  brand?: { name?: string } | string;
  model?: string;
  vehicleModelDate?: string | number;
  modelDate?: string | number;
  mileageFromOdometer?: { value?: number | string } | number | string;
  offers?: { price?: number | string } | { price?: number | string }[];
};

function brandName(brand: SchemaVehicle["brand"]): string {
  if (!brand) return "";
  return typeof brand === "string" ? brand : brand.name ?? "";
}

function price(offers: SchemaVehicle["offers"]): number | null {
  if (!offers) return null;
  const first = Array.isArray(offers) ? offers[0] : offers;
  return toNumber(first?.price);
}

function mileage(value: SchemaVehicle["mileageFromOdometer"]): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "object") return toNumber(value.value);
  return toNumber(value);
}

/**
 * Map a schema.org vehicle node onto our row shape. `filters` only supplies a
 * fallback make/model for the rare listing that omits them - it is never used to
 * decide whether the listing matches (that is `matchesFilters`' job).
 */
export function toCarListing(
  vehicle: SchemaVehicle,
  source: string,
  origin: string,
  filters: SearchFilters
): CarListing | null {
  const url = vehicle.url ?? "";
  if (!url) return null;

  const make = brandName(vehicle.brand) || filters.make || "";
  return {
    source,
    make,
    model: vehicle.model ?? filters.model ?? "",
    year: toNumber(vehicle.vehicleModelDate ?? vehicle.modelDate),
    price: price(vehicle.offers),
    km: mileage(vehicle.mileageFromOdometer),
    description: vehicle.description || vehicle.name || "",
    link: url.startsWith("http") ? url : `${origin}${url}`,
    countryOfMake: lookupOrigin(make),
    scrapedAt: new Date().toISOString(),
  };
}
