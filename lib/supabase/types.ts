// Row shapes for every table in supabase/schema.sql. No imports here on purpose:
// this file is the one thing shared between the scraper (run under tsx/Node ESM,
// which requires `.js`-suffixed relative imports) and the Next.js frontend (run
// under webpack, which doesn't) - keeping it import-free sidesteps having to pick
// a convention that works for both.

export type ListingRow = {
  id: string;
  unique_key: string;
  source: string;
  make: string;
  model: string;
  year: number | null;
  price: number | null;
  km: number | null;
  description: string | null;
  link: string;
  country_of_make: string | null;
  first_seen_at: string;
  last_seen_at: string;
  expires_at: string;
};

export type SavedSearchRow = {
  id: string;
  name: string;
  make: string | null;
  model: string | null;
  year_from: number | null;
  year_to: number | null;
  price_from: number | null;
  price_to: number | null;
  km_from: number | null;
  km_to: number | null;
  created_at: string;
};

export type SearchGroupRow = {
  id: string;
  name: string;
  created_at: string;
};

export type SearchGroupMemberRow = {
  group_id: string;
  saved_search_id: string;
};

export type ListingStatusRow = {
  listing_unique_key: string;
  status: "favorited" | "disliked";
  created_at: string;
};

export type AppStateValue = { at: string | null };

export type AppStateRow = {
  key: string;
  value: AppStateValue;
};
