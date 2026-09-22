import type { SupabaseClient } from "@supabase/supabase-js";
import type { CarListing } from "./types.js";
import { uniqueKeyFor } from "./supabase/uniqueKey.js";

/** Runs `fn` over `items` with at most `limit` in flight - plain upsert calls are one HTTP round trip each. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Upserts every listing via the `upsert_listing` SQL function (see
 * supabase/schema.sql) rather than the Supabase client's own `.upsert()` -
 * that function is what keeps `first_seen_at` untouched on a repeat sighting
 * while still refreshing `expires_at`.
 */
export async function writeListings(
  admin: SupabaseClient,
  listings: CarListing[]
): Promise<{ written: number; failed: number }> {
  let written = 0;
  let failed = 0;

  await mapWithConcurrency(listings, 10, async (listing) => {
    const { error } = await admin.rpc("upsert_listing", {
      p_unique_key: uniqueKeyFor(listing.source, listing.link),
      p_source: listing.source,
      p_make: listing.make,
      p_model: listing.model,
      p_year: listing.year,
      p_price: listing.price,
      p_km: listing.km,
      p_description: listing.description,
      p_link: listing.link,
      p_country_of_make: listing.countryOfMake,
    });
    if (error) {
      failed++;
      console.error(`Failed to upsert ${listing.link}: ${error.message}`);
    } else {
      written++;
    }
  });

  return { written, failed };
}

/** A listing not re-seen by any search for 14 days is treated as sold/delisted. */
export async function cleanupExpired(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin
    .from("listings")
    .delete()
    .lt("expires_at", new Date().toISOString())
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/** Ranks last 30 days; the frontend already ignores expired ones, this just keeps the table tidy. */
export async function cleanupExpiredRankings(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin
    .from("rankings")
    .delete()
    .lt("expires_at", new Date().toISOString())
    .select("id");
  // Tolerate the table not existing yet (migration not applied) - never fail the scrape over it.
  if (error) {
    console.warn(`Skipped rankings cleanup: ${error.message}`);
    return 0;
  }
  return data?.length ?? 0;
}
