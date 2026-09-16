import type { SearchFilters } from "./types.js";

// Used by `npm run verify` (a scraper smoke test), and as the fallback search
// when the `saved_searches` table has no rows yet - the app is meant to be
// driven from the Settings tab instead once it's set up, not from here.
// At least one of make / model / maxBudget must be set.
export const filters: SearchFilters = {
  make: "toyota",
  model: "land-cruiser",
  maxBudget: 150000,
  maxKm: 100000,
  minYear: 2018,
  maxYear: 2023,
};

function validate(f: SearchFilters) {
  if (!f.make && !f.model && !f.maxBudget) {
    throw new Error(
      "SearchFilters must include at least one of: make, model, maxBudget"
    );
  }
}
validate(filters);
