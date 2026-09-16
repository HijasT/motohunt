# MotoHunt

Tracks UAE used-car listings against saved searches you define in the app, and shows
them in a Results / Favorites / Settings UI. A GitHub Actions cron scrapes the sites
every 6 hours and writes into Supabase; the Next.js frontend reads straight from there.

Originally a Google-Sheets version (v1); see `DESIGN.md` for the v2 architecture this
now implements, and `HANDOFF.md` for the decisions made along the way.

## Sources

| Site | Status | How |
|---|---|---|
| Dubizzle | ✅ working | Playwright + schema.org JSON-LD (Imperva challenge handled) |
| CarSwitch | ✅ working | Playwright + schema.org JSON-LD |
| Al Futtaim Automall | ✅ working | their public JSON API (no browser needed) |
| YallaMotors | ⚠️ unverified | site unreachable from the dev machine — see `DEV_NOTES.md` |
| Al Aweer Auto Market | ❌ not built | site is still a pre-launch waitlist page with no listings |

`DEV_NOTES.md` has the verified URL shapes, query params and API details for each site.

## 1. Check the scrapers work

```bash
npm install
npx playwright install chromium
npm run verify
```

`npm run verify` runs every scraper against `lib/config.ts`'s sample filters and prints
what came back — no Supabase credentials needed, nothing written anywhere. Run this
whenever the app's Results tab looks wrong: it tells apart "no car matched" from
"that site changed and its scraper needs fixing".

## 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run `supabase/schema.sql` once.
3. From Project Settings → API, note the **Project URL**, the **anon public** key, and
   the **service_role** key.

## 3. Configure environment variables

Copy `.env.example` to `.env.local` for local frontend development:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxxx
```

The scraper needs its own two (same project, different key — see `.env.example` for
why the names differ):

```bash
export SUPABASE_URL=https://xxxx.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=xxxx
```

## 4. Run it locally

```bash
npm run dev            # the frontend, at localhost:3000
npm run scrape          # one scrape-and-write run
```

With no saved searches yet, `npm run scrape` falls back to `lib/config.ts`'s sample
filters so there's something to look at — normally you'd create a saved search from
the app's UI instead (top of the page → "New saved search" → "Save search").

## 5. Deploy

**Frontend (Vercel):**
1. Import the repo, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   as project environment variables.
2. This is a single-user app with no login (see `DESIGN.md`) — turn on Vercel's
   password protection (or an equivalent shared secret) so the site isn't public.

**Scraper (GitHub Actions):** add these as repo secrets (Settings → Secrets and
variables → Actions):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

`.github/workflows/scrape.yml` then runs every 6 hours, or on demand from the Actions
tab ("Run workflow").

## How it holds up over time

Scrapers read each site's **schema.org JSON-LD** rather than CSS classes. That data
exists for Google's benefit, so sites have a reason to keep it stable across
redesigns — it is much less brittle than matching on class names.

Every listing is also re-checked against its search's filters in `lib/filters.ts`
(scrape time) and again in `lib/supabase/queries.ts` (read time, for whichever saved
searches are currently selected). Several of these sites silently ignore a query
parameter they don't recognise and hand back their *unfiltered* list, so trusting
their filtering alone would quietly fill the app with cars that don't match.

If a site breaks, the run doesn't fail — the other sources still write, and the
failure is reported per-source in the Action's log.

## Layout

```
app/                     Next.js frontend (App Router)
  page.tsx                 tabs (Results / Favorites / Settings) + the filter bar
  components/               ListingCard, FilterBar, SavedSearchPicker, *Tab.tsx
supabase/
  schema.sql               run once in the Supabase SQL editor
index.ts                 scrape everything, write to Supabase   (npm run scrape)
verify.ts                scrape everything, print it, write nothing   (npm run verify)
lib/
  config.ts               sample filters - `npm run verify`'s input, and the
                           scrape fallback when no saved searches exist yet
  types.ts                CarListing + SearchFilters - the shared scraper contract
  run.ts                  runs all scrapers (optionally for several filter sets
                           sharing one browser), collects per-source results
  browser.ts              shared Playwright browser + JSON-LD reading
  jsonld.ts               schema.org vehicle -> CarListing mapping
  filters.ts              filter re-checking, number parsing, dedupe
  originLookup.ts         static make -> country-of-origin table
  supabaseWriter.ts        scraper-side: upserts CarListing[] into Supabase
  supabase/
    types.ts               DB row types (imported by both frontend and scraper)
    client.ts               frontend-only: browser/anon Supabase client
    admin.ts                 scraper-only: service-role Supabase client
    queries.ts               frontend-only: every read/write the UI makes
    savedSearchFilters.ts    scraper-only: saved_searches row -> SearchFilters
    uniqueKey.ts             scraper-only: source+link -> the DB's unique_key
scrapers/                one file per site
```
