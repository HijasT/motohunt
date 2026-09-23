-- Cars pushed out of a full rank list (General holds 10, other lists 5). They
-- show in their own "Dropped from ranking" section at the top of Favorites.
-- Stores the rank's own title/price/km/link, so a dropped car MotoHunt doesn't
-- scrape (e.g. a CarSwitch ad added from the chat) still appears there instead
-- of vanishing. One row per ad; ranking the car again deletes its row.

create table if not exists rank_dropouts (
  id uuid primary key default gen_random_uuid(),
  link text,
  list text not null,           -- the list it dropped out of
  rank int,                     -- its position just before it dropped
  title text,
  price numeric,
  km numeric,
  note text,
  dropped_at timestamptz not null default now()
);
create unique index if not exists rank_dropouts_link_key on rank_dropouts (link);

alter table rank_dropouts enable row level security;
drop policy if exists "anon full access" on rank_dropouts;
create policy "anon full access" on rank_dropouts for all to anon using (true) with check (true);
