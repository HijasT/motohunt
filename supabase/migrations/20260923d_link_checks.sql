-- Is each ranked / favorited ad still up? Written by checkLinks.ts (GitHub
-- Actions, daily + on demand), read by the app to tag sold/removed ads so they
-- can be removed by hand. Keyed by the canonical ad key (lib/adLink.ts
-- normLink), so every spelling of one ad's URL shares a single result.
--
-- status: 'ok'      - the ad page loaded normally
--         'gone'    - 404/410, redirected off the ad, or the page says sold / no longer available
--         'unknown' - couldn't tell (bot challenge, timeout, unexpected page) - treated as "not gone"

create table if not exists link_checks (
  link_key text primary key,
  link text not null,
  status text not null check (status in ('ok', 'gone', 'unknown')),
  detail text,
  checked_at timestamptz not null default now(),
  -- First check that found it gone; kept while it stays gone.
  gone_since timestamptz
);

alter table link_checks enable row level security;
drop policy if exists "anon read" on link_checks;
create policy "anon read" on link_checks for select to anon using (true);
