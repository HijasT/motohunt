# Handoff Note — MotoHunt

## Goal
Track UAE used-car listings against saved searches (make, model, price/km/year
ranges), scraped on a schedule, browsable with favorite/dislike triage.

**v1** (Google Sheets output) shipped first, then **v2** (`DESIGN.md` — Supabase +
Next.js) replaced it. This repo is now v2; v1's Sheets writer is gone.

## Status — v2 built and deployed, live in production

Supabase project created, schema deployed, Vercel frontend live (behind Vercel
Authentication - password protection needs a Pro plan, this account is on Hobby),
GitHub Actions secrets set, and the 6-hour cron has completed real successful runs
writing real listings into production Supabase. Not a dry run - the pipeline has
been exercised end to end with the user's actual saved searches.

### Scraper sources

| Source | Status |
|---|---|
| Dubizzle | ✅ working |
| CarSwitch | ✅ working |
| Al Futtaim Automall | ✅ working |
| Cars24 | ✅ working — added 2026-09-17, no schema.org JSON-LD (see `DEV_NOTES.md` for the RSC-parsing approach) |
| YallaMotors | ⚠️ unverified — blocked identically from two unrelated networks (this dev machine AND the GitHub Actions runner); looks like a datacenter/cloud-IP block, not a wrong-URL problem. See `DEV_NOTES.md`. |
| Al Aweer Auto Market | ❌ not built — site is a pre-launch waitlist page, nothing to scrape |

## Four open decisions from DESIGN.md, and what was done

DESIGN.md flagged these directly or implied them; here's how each was resolved and why.

1. **"5 sources" vs. the 3 that actually work.** `lib/run.ts`'s scraper list only
   has what exists (4 entries, Al Aweer omitted entirely). Wiring in a fifth
   scraper for a site with no inventory would only ever return `[]`.

2. **"only *new* listings, not a full catalog dump."** No site here offers a
   reliable "posted since" filter, so this wasn't achievable as literally stated.
   Instead, each run scrapes the full matching set for every saved search, and
   `upsert_listing()` (see `supabase/schema.sql`) makes re-scraping a still-live
   car a no-op on everything except `last_seen_at`/`expires_at` — same practical
   result (nothing duplicates, nothing false-flags as new) without needing a
   "since" parameter no site actually supports.

3. **`expires_at`: fixed at insert (DESIGN's draft) vs. refreshed on every
   sighting (built).** The original schema set `expires_at = now() + 14 days`
   once, at insert. A car still listed after 14 days would then get deleted and
   immediately re-inserted by the next scrape - resurfacing as **NEW** for a car
   that never left. `upsert_listing()` instead recomputes `expires_at` from *now*
   on every sighting, so a continuously-listed car just keeps sliding forward.
   `first_seen_at` is untouched either way (it's simply absent from the
   `ON CONFLICT ... DO UPDATE SET` clause), so the NEW badge still means what it
   should.

4. **Dislike permanence** — DESIGN.md's option (a) (dislike lives only as long as
   the FK'd `listings` row does) vs (b) (decoupled, survives the row's expiry).
   DESIGN recommended (a) for simplicity. **Built (b) instead**: `listing_status`
   has no FK to `listings` at all. Reasoning: point 3 above means a live car's row
   never actually expires while it's still listed, but once it *does* sell and
   later reappears as a different-but-similar ad, its `unique_key` may still
   collide (same source+link) or may not - either way, (a)'s FK-cascade meant a
   dislike could quietly evaporate on any purge/re-insert cycle, which defeats
   the entire point of disliking something. (b) costs one extra unindexed lookup
   per Results-tab query (fetch disliked/favorited keys, then exclude) - trivial
   at this data volume. The Settings tab includes an un-dislike view so this
   isn't a one-way door.

## Features added 2026-09-23

- **Price tracking** - `supabase/migrations/20260923_price_tracking.sql` adds
  `original_price` / `previous_price` / `price_changed_at` to `listings` and a
  `price_history` table; `upsert_listing()` fills them (same signature as before).
  Cards show "↓ 3,000 ~~49,000~~"; Results has a "price drops" filter.
- **Duplicate grouping** (`lib/listingInsights.ts`) - same make/model/year, km
  within 1.5%, price within 15%, and a listing must match *every* copy already in
  a group (no chaining). Frontend-only; favorite/hide act on all copies at once.
- **Deal score** - vs. same model ±1 year: median of similar-mileage cars (±30%),
  else a price-vs-km line, else plain median; needs ≥3 comparables. Trim level
  isn't scraped, so a V6 vs V8 gap can read as a "deal" - it's a hint, not a verdict.
- **Scraper status** - `index.ts` writes `app_state['last_scrape']` after each run
  (also on crash). Header pill + Settings panel; warns if >9h old or the run failed.
- **"Not seen" listings** - flagged when the latest run finished >13h after the
  listing was last seen and its site didn't fail in that run.
- **Edit saved searches** (Settings), **installable PWA** (`app/manifest.ts`, icons).

## What's next

Everything in the original ask is done and running. If picking this back up:

1. **YallaMotors** genuinely needs a non-datacenter connection (a real UAE
   residential/mobile network, not a VPN) to even find out whether the site is
   reachable at all - see `DEV_NOTES.md` for why this dev machine and GitHub
   Actions both hit the identical block and can't tell us more from here.
2. **Cars24 pagination** stops at the first server-rendered batch (~15-40 cars
   per URL) - their "load more" is a client-side fetch whose endpoint wasn't
   captured. Fine for comparison shopping; a real gap if you need their full
   inventory for a make.
3. **Password protection** would need a Vercel Pro plan; Vercel Authentication
   (log into Vercel to view) is the substitute on Hobby, which works fine since
   there's only one team member anyway.
4. Al Aweer has nothing to scrape until they launch their site.

## Architecture

```
app/                     Next.js frontend
supabase/schema.sql       run once, in Supabase's SQL editor
index.ts / verify.ts     scraper entrypoints (write to Supabase / print only)
lib/                       shared scraper logic + lib/supabase/ (DB layer)
scrapers/                one file per site
```
Full file-by-file breakdown is in `README.md`.

## Watch-outs
- `npm run verify` is the fastest way to catch site drift; `DEV_NOTES.md` records
  what was verified and when.
- CarSwitch soft-blocks on rapid requests (~15 hits in a couple of minutes
  returned empty responses during development) - `runScrapersForMany` runs saved
  searches one at a time against the sites for this reason, not concurrently.
- CarSwitch uses its own make slugs (`mercedes`, not `mercedes-benz`;
  `range-rover`, not `land-rover`) — `MAKE_SLUG_ALIASES` in
  `scrapers/carswitch.ts` maps the common ones.
- This is a single-user, no-login app. Protecting the deployed frontend (Vercel
  password protection or similar) is on you — it isn't built into the app itself.
- Personal price comparison only — keep the cron at 6h, don't hammer the sites.
- Kavak remains skipped (stricter anti-bot); Cars24 is now built (see above).
- GitHub Actions runners need Node 22+ (`@supabase/supabase-js`'s realtime client
  requires native `WebSocket`, stable only from Node 22) - `package.json` pins
  `engines.node` accordingly; don't drop the workflow's `node-version` back to 20.
- `index.ts` calls `process.exit(0)` after a successful run - without it, the
  Supabase client keeps a connection open and the process hangs indefinitely
  instead of exiting (would eventually be force-killed by the Action's timeout).
