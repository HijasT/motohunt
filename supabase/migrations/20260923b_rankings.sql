-- Rank tab: an ordered shortlist of cars, each ranked for 30 days.
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
--   insert into rankings (link, rank, title, note)
--   values ('https://...', 1, '2021 Nissan X-Trail SV', 'Best km for the price')
--   on conflict (link) do update set rank = excluded.rank,
--     title = coalesce(excluded.title, rankings.title),
--     note = coalesce(excluded.note, rankings.note);

create table if not exists rankings (
  id uuid primary key default gen_random_uuid(),
  link text not null unique,
  rank int not null,
  title text,
  price numeric,
  km numeric,
  note text,
  ranked_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);
create index if not exists rankings_expires_at_idx on rankings (expires_at);

alter table rankings enable row level security;
drop policy if exists "anon full access" on rankings;
create policy "anon full access" on rankings for all to anon using (true) with check (true);
