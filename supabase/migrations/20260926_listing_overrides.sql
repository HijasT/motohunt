-- Manual per-car corrections made from Favorites → Edit: spec, km, price.
-- The scraper's upsert_listing() rewrites listings.{price,km,description} on every
-- run, so an edit on the listing row itself would be wiped within hours. These live
-- separately, keyed by listings.unique_key, and are merged over the scraped row on
-- read (lib/supabase/queries.ts withOverrides). A null column = "no override here,
-- use the scraped value".
create table if not exists listing_overrides (
  unique_key text primary key,
  price numeric,
  km numeric,
  spec text,                          -- spec region, e.g. 'GCC' / 'American'; wins over the one parsed from the ad
  updated_at timestamptz not null default now()
);

alter table listing_overrides enable row level security;
create policy "anon full access" on listing_overrides for all to anon using (true) with check (true);
