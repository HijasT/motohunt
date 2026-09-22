-- Price tracking: remember what a listing cost when first seen and every time the
-- price changes, so the UI can show drops ("was 49,900") and a deal score has
-- history to build on later. Purely additive - safe to run against a live
-- database while the old scraper is still deployed (upsert_listing keeps its
-- exact signature).

alter table listings
  add column if not exists original_price numeric,       -- price at first sighting
  add column if not exists previous_price numeric,       -- price before the most recent change
  add column if not exists price_changed_at timestamptz; -- when that change was seen

update listings set original_price = price where original_price is null;

-- One row per observed price (first sighting + each change). No FK to listings,
-- same reasoning as listing_status: history should outlive a purge/re-insert.
create table if not exists price_history (
  id bigint generated always as identity primary key,
  listing_unique_key text not null,
  price numeric not null,
  recorded_at timestamptz not null default now()
);
create index if not exists price_history_key_idx on price_history (listing_unique_key, recorded_at);

insert into price_history (listing_unique_key, price, recorded_at)
select unique_key, price, first_seen_at
from listings l
where price is not null
  and not exists (select 1 from price_history h where h.listing_unique_key = l.unique_key);

alter table price_history enable row level security;
drop policy if exists "anon read" on price_history;
create policy "anon read" on price_history for select to anon using (true);

-- Same contract as before (first_seen_at untouched, expires_at slides forward),
-- plus: a missing price on a re-sighting keeps the last known price instead of
-- blanking it, and a real change is recorded in previous_price/price_history.
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
