import type { SupabaseClient } from "@supabase/supabase-js";
import { filters as fallbackFilters } from "./lib/config.js";
import { createAdminClient } from "./lib/supabase/admin.js";
import { toSearchFilters } from "./lib/supabase/savedSearchFilters.js";
import type { SavedSearchRow, ScrapeSourceStatus, ScrapeStatus } from "./lib/supabase/types.js";
import type { SearchFilters } from "./lib/types.js";
import { runScrapersForMany, printSummary, type SearchRun } from "./lib/run.js";
import { writeListings, cleanupExpired, cleanupExpiredRankings } from "./lib/supabaseWriter.js";
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

function summarizeSources(runs: SearchRun[]): ScrapeSourceStatus[] {
  const byName = new Map<string, ScrapeSourceStatus>();
  for (const run of runs) {
    for (const r of run.results) {
      const s = byName.get(r.name) ?? { name: r.name, listings: 0, failedSearches: 0 };
      if (r.ok) s.listings += r.listings.length;
      else {
        s.failedSearches++;
        s.error ??= r.error.slice(0, 300);
      }
      byName.set(r.name, s);
    }
  }
  return [...byName.values()];
}

/** Best-effort: the frontend's "Updated Xh ago" / scraper health reads this. Never fails the run. */
async function writeScrapeStatus(admin: SupabaseClient, status: ScrapeStatus): Promise<void> {
  const { error } = await admin.from("app_state").upsert({ key: "last_scrape", value: status });
  if (error) console.error(`Couldn't write scrape status: ${error.message}`);
}

async function main(admin: SupabaseClient, startedAt: number) {
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
  const unranked = await cleanupExpiredRankings(admin);
  if (unranked > 0) console.log(`Supabase: removed ${unranked} expired ranking(s).`);

  await writeScrapeStatus(admin, {
    at: new Date().toISOString(),
    ok: failed === 0 && allListings.length > 0,
    durationMs: Date.now() - startedAt,
    searches: searches.length,
    written,
    failed,
    sources: summarizeSources(runs),
    error: allListings.length === 0 ? "No listings from any source" : undefined,
  });
}

const startedAt = Date.now();
const admin = createAdminClient();

main(admin, startedAt)
  .then(() => process.exit(0)) // supabase-js keeps a connection open that would otherwise hang the process
  .catch(async (err) => {
    console.error(err);
    await writeScrapeStatus(admin, {
      at: new Date().toISOString(),
      ok: false,
      durationMs: Date.now() - startedAt,
      searches: 0,
      written: 0,
      failed: 0,
      sources: [],
      error: String(err?.message ?? err).slice(0, 500),
    });
    process.exit(1);
  });
