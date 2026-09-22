-- Models (or whole makes) to leave out of search results, e.g. "never show me a
-- Renault Symbol". Applied in the app at display time, not in the scraper, so
-- unblocking brings every matching listing straight back. Matching ignores case
-- and punctuation ("X-Trail" = "X TRAIL"). model = null blocks the whole make.
-- Favorites and ranked cars are never hidden by this - those were chosen on purpose.

create table if not exists blocked_models (
  id uuid primary key default gen_random_uuid(),
  make text not null,
  model text,
  created_at timestamptz not null default now()
);

alter table blocked_models enable row level security;
drop policy if exists "anon full access" on blocked_models;
create policy "anon full access" on blocked_models for all to anon using (true) with check (true);
