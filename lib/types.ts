// A single normalized listing, same shape regardless of which site it came from.
export interface CarListing {
  source: string;          // e.g. "Dubizzle", "YallaMotors"
  make: string;
  model: string;
  year: number | null;
  price: number | null;    // AED
  km: number | null;
  description: string;
  link: string;
  countryOfMake: string | null;
  scrapedAt: string;       // ISO timestamp
}

// Your search criteria. At least one of make/model/budget must be set (enforced in config.ts).
export interface SearchFilters {
  make?: string;
  model?: string;
  minBudget?: number;      // AED
  maxBudget?: number;      // AED
  minKm?: number;
  maxKm?: number;
  minYear?: number;
  maxYear?: number;
}
