# MotoHunt v2 — Design & Schema

## Stack
- **Frontend**: Next.js (App Router), deployed on Vercel
- **DB**: Supabase (Postgres)
- **Scraper**: GitHub Actions cron (Node/TS + Playwright) — writes directly to Supabase via service role key. Not run on Vercel (serverless timeout too short for Playwright scraping).
- **Auth**: none — single user, no login. Protect the deployed site with Vercel's built-in password protection or a simple shared secret, not app-level auth.

## Data flow
1. GitHub Actions cron runs on a schedule.
2. For each row in `saved_searches`, build filter params, scrape the 5 sites for listings matching those filters (only *new* listings — not full catalog dump).
3. Upsert into `listings` by `unique_key`:
   - New listing → insert, `first_seen_at = now()`, `last_seen_at = now()`.
   - Already exists → update `last_seen_at = now()` (and price/km in case they changed).
4. Same job (or a second scheduled job) deletes rows where `expires_at < now()`.
5. Frontend reads from Supabase directly (via `@supabase/supabase-js`, anon key, read-only RLS policies) — no API layer needed for reads. Writes (favorite/dislike/save search) go through Supabase client too, or Next.js server actions if you want to hide the service logic.

## Schema (SQL)

```sql
create table listings (
  id uuid primary key default gen_random_uuid(),
  unique_key text unique not null,       -- hash of source + link, used for de-dup
  source text not null,                  -- 'Dubizzle', 'YallaMotors', etc.
  make text not null,
  model text not null,
  year int,
  price numeric,
  km numeric,
  description text,
  link text not null,
  country_of_make text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days')
);

create index on listings (expires_at);
create index on listings (make, model);

create table saved_searches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  make text,
  model text,
  year_from int,
  year_to int,
  price_from numeric,
  price_to numeric,
  km_from numeric,
  km_to numeric,
  created_at timestamptz not null default now()
);
-- at least one of make/model/price_to must be set — enforce in app layer

create table search_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table search_group_members (
  group_id uuid references search_groups(id) on delete cascade,
  saved_search_id uuid references saved_searches(id) on delete cascade,
  primary key (group_id, saved_search_id)
);

create table listing_status (
  listing_unique_key text primary key references listings(unique_key) on delete cascade,
  status text not null check (status in ('favorited', 'disliked')),
  created_at timestamptz not null default now()
);

-- tracks last time the user viewed results, to compute "new since last visit"
create table app_state (
  key text primary key,
  value jsonb not null
);
-- seed row: insert into app_state (key, value) values ('last_visit', '{"at": null}');
```

## Core query logic

**Results tab (neutral only, respects filters from selected saved search / group):**
```sql
select l.*
from listings l
left join listing_status ls on ls.listing_unique_key = l.unique_key
where ls.listing_unique_key is null   -- excludes favorited AND disliked
  and l.expires_at > now()
  -- + WHERE clauses built from the selected saved_search(es), OR'd together if a group
order by l.first_seen_at desc;
```

**"New" flag**: `l.first_seen_at > (select (value->>'at')::timestamptz from app_state where key = 'last_visit')`. Update `app_state.last_visit` to `now()` when the Search Results tab is opened/refreshed (or on a manual "mark as seen" if you'd rather control it explicitly).

**Favorites tab:**
```sql
select l.* from listings l
join listing_status ls on ls.listing_unique_key = l.unique_key and ls.status = 'favorited'
order by ls.created_at desc;
```

**Dislike action**: insert into `listing_status` with status `'disliked'`. Row stays in `listings` (unique_key still blocks re-insertion by the scraper), just excluded from Results/Favorites views.

**Expiry cleanup** (run in the same or a separate scheduled GitHub Action):
```sql
delete from listings where expires_at < now();
-- listing_status rows cascade-delete automatically (FK on delete cascade)
```
Note: once a disliked listing expires and its `listings` row is deleted, the dislike history is lost — if that matters, dislikes should reference something more permanent than `unique_key` on `listings` (e.g. keep a separate `dismissed_keys` table with no FK, never cleaned up). **Decide before building**: do you want dislikes to be permanent (car never reappears even after 14-day cycle) or just permanent-while-the-old-listing-still-exists? If permanent forever, split `listing_status` off `listings` with no cascade FK.

## Pages / UI structure

```
app/
  page.tsx                    → main layout: top filter bar + 3 tabs
  components/
    FilterBar.tsx              → make/model/year range/price range/km range inputs
    SavedSearchPicker.tsx      → dropdown/list of saved searches, multi-select → "Save as group"
    ResultsTab.tsx             → table/grid, sort + filter controls, "NEW" badge, favorite/dislike buttons
    FavoritesTab.tsx           → same card layout, no dislike button (only un-favorite)
    SettingsTab.tsx            → manage saved searches, manage groups, maybe scrape frequency display
lib/
  supabase.ts                  → client init (anon key, browser + server variants)
  queries.ts                   → the queries above, typed
```

**Top bar**: filter inputs double as "build a new saved search" — user sets values, hits "Save this search" → writes a row to `saved_searches`. Selecting one or more existing saved searches (or a saved group) re-runs the Results query with those filters OR'd.

**Results tab**: sort (price/km/year/date found), filter (further narrow within current saved search/group results), NEW badge if `first_seen_at` > last_visit, Favorite ♥ / Dislike ✕ buttons per row.

**Favorites tab**: same list rendering, filtered to `status = 'favorited'`.

**Settings tab**: CRUD for saved searches and groups; maybe a manual dislike-history view if you want to be able to un-dislike something.

## Open decision before Claude Code builds this
Dislike permanence (see note above) — pick one:
- (a) Dislike lasts only as long as the original listing row exists (gets cleared after 14-day expiry, car could reappear later) — matches current FK design, simplest.
- (b) Dislike is permanent regardless of expiry — needs `listing_status` decoupled from `listings` (own table, keyed by unique_key with no FK/cascade).

Recommend (a) for v1 — simpler, and if a car's been off every site for 14+ days it's probably sold anyway, so a stale dislike re-surfacing after that long is a minor edge case.

## Env vars needed
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (GitHub Actions only, never exposed to frontend)

## GitHub Actions
Reuse the existing scraper structure from the MotoHunt v1 handoff (per-site scraper files, `CarListing` shape) — swap `lib/sheets.ts` for a `lib/supabase.ts` writer using `@supabase/supabase-js` with the service role key, doing the upsert-by-unique_key logic above instead of writing to a Sheet. Loop over all rows in `saved_searches` instead of a single hardcoded filter object.
