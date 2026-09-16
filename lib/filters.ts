import type { CarListing, SearchFilters } from "./types.js";

/** "Land Cruiser" / "land_cruiser" -> "land-cruiser". Used for URL slugs and loose comparison. */
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Pulls the first number out of messy text: "AED 149,900" -> 149900, "85,293 km" -> 85293. */
export function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  const digits = value.replace(/[^\d.]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Every scraper runs its results through this before returning them.
 *
 * Sites disagree about which filters they support server-side (and some silently
 * ignore a parameter they don't recognise, returning the *unfiltered* list instead
 * of an error). Re-checking here means a site's URL params can drift without the
 * sheet filling up with cars that don't match what was asked for.
 */
export function matchesFilters(listing: CarListing, f: SearchFilters): boolean {
  if (f.make && !looseIncludes(listing.make, f.make)) return false;
  if (f.model && !looseIncludes(listing.model, f.model)) return false;

  // A listing with no price/km/year can't be proven to violate a limit, so keep it
  // rather than silently dropping a car that might be a match.
  if (f.minBudget !== undefined && listing.price !== null && listing.price < f.minBudget) return false;
  if (f.maxBudget !== undefined && listing.price !== null && listing.price > f.maxBudget) return false;
  if (f.minKm !== undefined && listing.km !== null && listing.km < f.minKm) return false;
  if (f.maxKm !== undefined && listing.km !== null && listing.km > f.maxKm) return false;
  if (f.minYear !== undefined && listing.year !== null && listing.year < f.minYear) return false;
  if (f.maxYear !== undefined && listing.year !== null && listing.year > f.maxYear) return false;

  return true;
}

/**
 * Loose containment on slugs, both directions: sites name the same car differently
 * ("Land Cruiser" vs "LAND CRUISER PRADO", "Mercedes" vs "Mercedes-Benz"), so a
 * filter of "land-cruiser" should match "land-cruiser-prado", and a listing model
 * of "prado" should match a filter of "land-cruiser-prado".
 */
function looseIncludes(listingValue: string, filterValue: string): boolean {
  const a = slugify(listingValue);
  const b = slugify(filterValue);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/** Two sites can carry the same dealer's car; the sheet upserts by link, so dedupe on it here too. */
export function dedupeByLink(listings: CarListing[]): CarListing[] {
  const byLink = new Map<string, CarListing>();
  for (const listing of listings) {
    if (!listing.link) continue;
    if (!byLink.has(listing.link)) byLink.set(listing.link, listing);
  }
  return [...byLink.values()];
}
