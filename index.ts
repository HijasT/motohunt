import type { SupabaseClient } from "@supabase/supabase-js";
import { filters as fallbackFilters } from "./lib/config.js";
import { createAdminClient } from "./lib/supabase/admin.js";
import { toSearchFilters } from "./lib/supabase/savedSearchFilters.js";
import type { SavedSearchRow } from "./lib/supabase/types.js";
import type { SearchFilters } from "./lib/types.js";
import { runScrapersForMany, printSummary } from "./lib/run.js";
import { writeListings, cleanupExpired } from "./lib/supabaseWriter.js";
import { dedupeByLink } from "./lib/filters.js";

async function loadSearches(admin: SupabaseClient): Promise<{ label: string; filters: SearchFilters }[]> {
  const { data, error } = await admin.from("saved_searches").select("*");
  if (error) throw error;

  const rows = (data ?? []) as SavedSearchRow[];
  if (rows.length === 0) {
    console.log("No saved searches in Supabase yet - falling back to lib/config.ts.");
    return [{ label: "config.ts", filters: fallbackFilters }];
  }
  return rows.map((row) => ({ label: row.name, filters: toSearchFilters(row) }));
}

async function main() {
  const admin = createAdminClient();
  const searches = await loadSearches(admin);

  const runs = await runScrapersForMany(searches);

  for (const run of runs) {
    console.log(`\n=== ${run.label}`);
    printSummary(run.results, run.listings.length);
  }

  const allListings = dedupeByLink(runs.flatMap((r) => r.listings));
  console.log(`\nTotal unique listings across ${searches.length} search(es): ${allListings.length}`);

  if (allListings.length === 0) {
    console.warn("No listings from any source - check the per-source output above.");
  }

  const { written, failed } = await writeListings(admin, allListings);
  console.log(`Supabase: ${written} upserted, ${failed} failed.`);

  const purged = await cleanupExpired(admin);
  if (purged > 0) console.log(`Supabase: purged ${purged} expired listing(s).`);
}

main()
  .then(() => process.exit(0)) // supabase-js keeps a connection open that would otherwise hang the process
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
