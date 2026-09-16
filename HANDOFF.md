# Handoff Note — MotoHunt

## Goal
Track UAE used-car listings against saved searches (make, model, price/km/year
ranges), scraped on a schedule, browsable with favorite/dislike triage.

**v1** (Google Sheets output) shipped first, then **v2** (`DESIGN.md` — Supabase +
Next.js) replaced it. This repo is now v2; v1's Sheets writer is gone.

## Status — v2 built, not yet deployed

Everything in `DESIGN.md` is implemented: schema, scrapers writing into Supabase,
and the Next.js Results/Favorites/Settings UI. `npm run build` and `npm run
typecheck` both pass. **Not done, because it needs your accounts**: creating the
actual Supabase project and Vercel deployment — `README.md` has the exact steps.

### Scraper sources (unchanged from v1, still verified)

| Source | Status |
|---|---|
| Dubizzle | ✅ working |
| CarSwitch | ✅ working |
| Al Futtaim Automall | ✅ working |
| YallaMotors | ⚠️ unverified — site unreachable from this machine, see `DEV_NOTES.md` |
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

## What's next (needs your accounts, so it's on you)

1. Create the Supabase project, run `supabase/schema.sql`, grab the three keys.
2. `npm run dev` locally with `.env.local` set (see `.env.example`), create a
   couple of saved searches, confirm Results/Favorites/Settings all work.
3. `npm run scrape` locally (or `npm run verify` first to sanity-check the sites
   without touching Supabase at all) to confirm the writer path works end to end.
4. Deploy the frontend to Vercel, turn on password protection (no login is built —
   see DESIGN.md's Auth note), add the GitHub Actions secrets, confirm the cron
   fires.
5. **If continuing to build:** YallaMotors needs someone on a UAE network to run
   `npm run verify` and fix the URL shapes in `scrapers/yallamotors.ts` (see
   `DEV_NOTES.md` for exactly what's broken and how to check). Al Aweer has
   nothing to scrape until they launch their site.

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
- Cars24 and Kavak remain skipped (stricter anti-bot).
