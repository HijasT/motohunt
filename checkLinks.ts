/**
 * Checks whether every ranked and favorited ad is still up, and records the
 * result in `link_checks` so the app can tag sold/removed ads (removing them
 * stays a manual decision in the app).
 *
 *   npm run check-links              # check and write results (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 *   npm run check-links -- --dry-run # check and print only; reads with the anon key if no service key is set
 *
 * Runs daily from .github/workflows/check-links.yml, and on demand from the
 * Actions tab ("Run workflow").
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normLink } from "./lib/adLink.js";
import { closeBrowser, newContext, sleep } from "./lib/browser.js";
import { checkAdLink, warmUpDubizzle, type LinkCheckResult } from "./lib/linkCheck.js";

const DRY_RUN = process.argv.includes("--dry-run");
/** Be polite: one ad at a time, with a pause between them. */
const PAUSE_MS = 2500;

function client(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? (DRY_RUN ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY : undefined);
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or use --dry-run with the anon key).");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Links of every active rank and every favorite, one per ad (duplicate URLs of the same ad collapse). */
async function loadLinks(db: SupabaseClient): Promise<Map<string, { link: string; label: string }>> {
  const links = new Map<string, { link: string; label: string }>();
  const add = (link: string | null, label: string) => {
    if (!link) return;
    const key = normLink(link);
    if (!links.has(key)) links.set(key, { link, label });
  };

  const { data: ranks, error: rankError } = await db
    .from("rankings")
    .select("link, title, list, rank")
    .gt("expires_at", new Date().toISOString());
  if (rankError) throw rankError;
  for (const r of ranks ?? []) add(r.link, `${r.list} #${r.rank} ${r.title ?? ""}`.trim());

  const { data: favs, error: favError } = await db.from("listing_status").select("listing_unique_key").eq("status", "favorited");
  if (favError) throw favError;
  const keys = (favs ?? []).map((f) => f.listing_unique_key);
  if (keys.length > 0) {
    const { data: listings, error } = await db.from("listings").select("link, year, make, model").in("unique_key", keys);
    if (error) throw error;
    for (const l of listings ?? []) add(l.link, `Favorite ${l.year ?? ""} ${l.make} ${l.model}`);
  }
  return links;
}

async function main() {
  const db = client();
  const links = await loadLinks(db);
  console.log(`Checking ${links.size} ad link(s)${DRY_RUN ? " (dry run - nothing is written)" : ""}...\n`);

  const { data: previous } = await db.from("link_checks").select("link_key, status, gone_since");
  const goneSince = new Map((previous ?? []).filter((p) => p.status === "gone").map((p) => [p.link_key, p.gone_since]));

  const ctx = await newContext();
  const page = await ctx.newPage();
  const results: { key: string; link: string; label: string; result: LinkCheckResult }[] = [];

  // Dubizzle links last and together, so the (slow) challenge warm-up happens once.
  const ordered = [...links.entries()].sort(([a], [b]) => Number(a.includes("dubizzle")) - Number(b.includes("dubizzle")));
  let warmedUp = false;
  try {
    for (const [key, { link, label }] of ordered) {
      if (!warmedUp && /dubizzle\.com/i.test(link)) {
        await warmUpDubizzle(page);
        warmedUp = true;
      }
      const result = await checkAdLink(page, link);
      results.push({ key, link, label, result });
      const mark = result.status === "ok" ? "ok     " : result.status === "gone" ? "GONE   " : "unknown";
      console.log(`${mark} ${label.slice(0, 50).padEnd(50)} ${result.status === "ok" ? "" : result.detail}`);
      await sleep(PAUSE_MS);
    }
  } finally {
    await closeBrowser();
  }

  const counts = { ok: 0, gone: 0, unknown: 0 };
  for (const r of results) counts[r.result.status]++;
  console.log(`\n${counts.ok} ok, ${counts.gone} gone, ${counts.unknown} couldn't be checked.`);

  if (DRY_RUN) return;
  const now = new Date().toISOString();
  // A check that couldn't read the page says nothing new: keep an earlier ok/gone
  // verdict rather than overwrite it (one flaky run mustn't clear a "sold" tag).
  const checkedBefore = new Set((previous ?? []).map((p) => p.link_key));
  const toSave = results.filter((r) => r.result.status !== "unknown" || !checkedBefore.has(r.key));
  const { error } = await db.from("link_checks").upsert(
    toSave.map((r) => ({
      link_key: r.key,
      link: r.link,
      status: r.result.status,
      detail: r.result.detail,
      checked_at: now,
      gone_since: r.result.status === "gone" ? goneSince.get(r.key) ?? now : null,
    }))
  );
  if (error) throw error;
  console.log(`Saved ${toSave.length} result(s) to link_checks.`);
}

main()
  .then(() => process.exit(0)) // supabase-js keeps a connection open otherwise (see index.ts)
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
