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
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days')
);

create index listings_expires_at_idx on listings (expires_at);
create index listings_make_model_idx on listings (make, model);

-- Insert-or-refresh a sighting of a listing. `first_seen_at` is left untouched on
-- conflict (it's simply absent from the UPDATE SET below); everything else,
-- including `expires_at`, is refreshed to "now + 14 days" so a listing that's
-- still live keeps sliding forward instead of expiring out from under itself.
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
language sql
as $$
  insert into listings (
    unique_key, source, make, model, year, price, km, description, link, country_of_make
  ) values (
    p_unique_key, p_source, p_make, p_model, p_year, p_price, p_km, p_description, p_link, p_country_of_make
  )
  on conflict (unique_key) do update set
    price = excluded.price,
    km = excluded.km,
    description = excluded.description,
    last_seen_at = now(),
    expires_at = now() + interval '14 days';
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

-- Single-row key/value store; currently just tracks "last time the Results tab
-- was viewed", used to compute each listing's NEW badge.
create table app_state (
  key text primary key,
  value jsonb not null
);
insert into app_state (key, value) values ('last_visit', '{"at": null}');

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

create policy "anon full access" on listings for all to anon using (true) with check (true);
create policy "anon full access" on saved_searches for all to anon using (true) with check (true);
create policy "anon full access" on search_groups for all to anon using (true) with check (true);
create policy "anon full access" on search_group_members for all to anon using (true) with check (true);
create policy "anon full access" on listing_status for all to anon using (true) with check (true);
create policy "anon full access" on app_state for all to anon using (true) with check (true);
