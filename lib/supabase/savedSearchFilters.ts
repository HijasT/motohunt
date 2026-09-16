import type { SearchFilters } from "../types.js";
import type { SavedSearchRow } from "./types.js";

/** Turns a `saved_searches` row into the shape every scraper already accepts. */
export function toSearchFilters(row: SavedSearchRow): SearchFilters {
  return {
    make: row.make ?? undefined,
    model: row.model ?? undefined,
    minBudget: row.price_from ?? undefined,
    maxBudget: row.price_to ?? undefined,
    minKm: row.km_from ?? undefined,
    maxKm: row.km_to ?? undefined,
    minYear: row.year_from ?? undefined,
    maxYear: row.year_to ?? undefined,
  };
}
