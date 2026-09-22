-- MotoHunt v2 schema. Run this once in the Supabase SQL editor for a new project.
--
-- Differences from the original DESIGN.md draft (see HANDOFF.md for why):
--   1. `expires_at` is recomputed from `last_seen_at` on every sighting, not fixed
--      at insert - see `upsert_listing()` below. A car listed continuously would
--      otherwise get deleted and immediately re-inserted as "new" every 14 days.
--   2. `listing_status` has no FK to `listings` (decision (a) from DESIGN.md was
--      reconsidered to (b) here - see note above the table). A dislike is what
--      keeps a stale, re-scraped duplicate off the Results tab; tying it to the
--      listing row's lifetime defeats that the moment the row expires and the ad
--      is still live next scrape.

create extension if not exists pgcrypto;

create table listings (
  id uuid primary key default gen_random_uuid(),
  unique_key text unique not null,       -- sha256(source + '|' + link), see lib/supabase/uniqueKey.ts
  source text not null,                  -- 'Dubizzle', 'CarSwitch', etc.
  make text not null,
  model text not null,
  year int,
  price numeric,
  km numeric,
  description text,
  link text not null,
  country_of_make text,
  original_price numeric,                -- price at first sighting
  previous_price numeric,                -- price before the most recent change
  price_changed_at timestamptz,          -- when that change was seen
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days')
);

create index listings_expires_at_idx on listings (expires_at);
create index listings_make_model_idx on listings (make, model);

-- One row per observed price (first sighting + each change). No FK to listings,
-- same reasoning as listing_status: history should outlive a purge/re-insert.
create table price_history (
  id bigint generated always as identity primary key,
  listing_unique_key text not null,
  price numeric not null,
  recorded_at timestamptz not null default now()
);
create index price_history_key_idx on price_history (listing_unique_key, recorded_at);

-- Insert-or-refresh a sighting of a listing. `first_seen_at` is never touched on
-- a repeat sighting; `expires_at` is refreshed to "now + 14 days" so a listing
-- that's still live keeps sliding forward instead of expiring out from under
-- itself. A missing price on a re-sighting keeps the last known price, and a
-- real change is recorded in previous_price/price_changed_at + price_history.
create or replace function upsert_listing(
  p_unique_key text,
  p_source text,
  p_make text,
  p_model text,
  p_year int,
  p_price numeric,
  p_km numeric,
  p_description text,
  p_link text,
  p_country_of_make text
) returns void
language plpgsql
as $$
declare
  v_old_price numeric;
  v_exists boolean;
begin
  select price, true into v_old_price, v_exists from listings where unique_key = p_unique_key for update;

  if v_exists is null then
    insert into listings (
      unique_key, source, make, model, year, price, original_price, km, description, link, country_of_make
    ) values (
      p_unique_key, p_source, p_make, p_model, p_year, p_price, p_price, p_km, p_description, p_link, p_country_of_make
    )
    on conflict (unique_key) do nothing;
    if p_price is not null then
      insert into price_history (listing_unique_key, price) values (p_unique_key, p_price);
    end if;
    return;
  end if;

  if p_price is not null and v_old_price is not null and p_price <> v_old_price then
    update listings set
      previous_price = v_old_price,
      price_changed_at = now()
    where unique_key = p_unique_key;
    insert into price_history (listing_unique_key, price) values (p_unique_key, p_price);
  end if;

  update listings set
    price = coalesce(p_price, price),
    original_price = coalesce(original_price, p_price),
    km = p_km,
    description = p_description,
    last_seen_at = now(),
    expires_at = now() + interval '14 days'
  where unique_key = p_unique_key;
end;
$$;

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
  created_at timestamptz not null default now(),
  constraint saved_searches_needs_criteria
    check (make is not null or model is not null or price_to is not null)
);

create table search_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table search_group_members (
  group_id uuid not null references search_groups(id) on delete cascade,
  saved_search_id uuid not null references saved_searches(id) on delete cascade,
  primary key (group_id, saved_search_id)
);

-- No FK to `listings` - deliberately decoupled (see header note). A dislike must
-- survive the disliked listing's row being deleted and re-inserted by the next
-- scrape (which happens naturally: expired rows are purged, then the site's still
-- -live ad gets upserted again on a fresh `unique_key` match). Un-doing a dislike
-- is a manual action in the Settings tab, not something expiry should do for you.
create table listing_status (
  listing_unique_key text primary key,
  status text not null check (status in ('favorited', 'disliked')),
  created_at timestamptz not null default now()
);

-- Small key/value store:
--   last_visit  - last time the app was opened, drives each listing's NEW badge
--   last_scrape - summary of the latest scraper run (written by index.ts), drives
--                 the "Updated Xh ago" header and the Settings scraper status
create table app_state (
  key text primary key,
  value jsonb not null
);
insert into app_state (key, value) values ('last_visit', '{"at": null}');

-- rankings (Rank tab): an ordered shortlist of cars, each ranked for 30 days.
--
-- Keyed by the ad's URL rather than listings.unique_key so it can be written from
-- outside the app (e.g. a claude.ai chat with the Supabase connector) with nothing
-- but the link - and so a car MotoHunt never scraped can still be ranked; the
-- title/price/km columns are the fallback display for those. The frontend matches
-- ranks to listings by link (ignoring query string / trailing slash).
--
-- A ranked car is left out of Favorites and Results until its rank expires, at
-- which point it simply reappears wherever it was before (Favorites if favorited).
--
-- To set or move a rank from SQL, keeping the original 30-day window:
--   insert into rankings (list, link, rank, title, note)
--   values ('General', 'https://...', 1, '2021 Nissan X-Trail SV', 'Best km for the price')
--   on conflict (list, link) do update set rank = excluded.rank,
--     title = coalesce(excluded.title, rankings.title),
--     note = coalesce(excluded.note, rankings.note);

create table rankings (
  id uuid primary key default gen_random_uuid(),
  list text not null default 'General',  -- e.g. General, Above-Budget, Dodge
  link text,                             -- null for cars only ever shared as text
  rank int not null,
  title text,
  price numeric,
  km numeric,
  note text,
  ranked_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);
create index rankings_expires_at_idx on rankings (expires_at);
-- One ad can be ranked in two lists (a Dodge in both General and Dodge).
create unique index rankings_list_link_key on rankings (list, link);


-- Is each ranked / favorited ad still up? Written by checkLinks.ts (GitHub
-- Actions, daily + on demand), read by the app to tag sold/removed ads so they
-- can be removed by hand. Keyed by the canonical ad key (lib/adLink.ts
-- normLink), so every spelling of one ad's URL shares a single result.
--
-- status: 'ok'      - the ad page loaded normally
--         'gone'    - 404/410, redirected off the ad, or the page says sold / no longer available
--         'unknown' - couldn't tell (bot challenge, timeout, unexpected page) - treated as "not gone"

create table link_checks (
  link_key text primary key,
  link text not null,
  status text not null check (status in ('ok', 'gone', 'unknown')),
  detail text,
  checked_at timestamptz not null default now(),
  -- First check that found it gone; kept while it stays gone.
  gone_since timestamptz
);

-- Models (or whole makes) to leave out of search results, e.g. "never show me a
-- Renault Symbol". Applied in the app at display time, not in the scraper, so
-- unblocking brings every matching listing straight back. Matching ignores case
-- and punctuation ("X-Trail" = "X TRAIL"). model = null blocks the whole make.
-- Favorites and ranked cars are never hidden by this - those were chosen on purpose.

create table blocked_models (
  id uuid primary key default gen_random_uuid(),
  make text not null,
  model text,
  created_at timestamptz not null default now()
);

-- RLS: this is a single-user app with no login (see DESIGN.md Auth section). The
-- anon key is used from the browser and protected at the edge (Vercel password
-- protection / shared secret), not per-row - so every policy below is a blanket
-- allow for the anon role. The scraper writes with the service role key, which
-- bypasses RLS entirely.
alter table listings enable row level security;
alter table saved_searches enable row level security;
alter table search_groups enable row level security;
alter table search_group_members enable row level security;
alter table listing_status enable row level security;
alter table app_state enable row level security;
alter table price_history enable row level security;
alter table rankings enable row level security;
alter table link_checks enable row level security;
alter table blocked_models enable row level security;

create policy "anon full access" on listings for all to anon using (true) with check (true);
create policy "anon full access" on saved_searches for all to anon using (true) with check (true);
create policy "anon full access" on search_groups for all to anon using (true) with check (true);
create policy "anon full access" on search_group_members for all to anon using (true) with check (true);
create policy "anon full access" on listing_status for all to anon using (true) with check (true);
create policy "anon full access" on app_state for all to anon using (true) with check (true);
create policy "anon read" on price_history for select to anon using (true);
create policy "anon full access" on rankings for all to anon using (true) with check (true);
create policy "anon read" on link_checks for select to anon using (true);
create policy "anon full access" on blocked_models for all to anon using (true) with check (true);
