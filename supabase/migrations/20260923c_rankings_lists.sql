-- Rankings become several named lists (e.g. General, Above-Budget,
-- High-Mileage/Budget, Dodge) instead of one. The same ad may sit in two lists
-- (a Dodge can compete in both General and Dodge), so uniqueness moves from
-- `link` to `(list, link)`. `link` becomes optional for cars that were only
-- ever shared as text (no ad URL) - those rows are identified by id alone.
--
-- Upsert from SQL now targets the pair:
--   insert into rankings (list, link, rank, title, price, km, note) values (...)
--   on conflict (list, link) do update set rank = excluded.rank, ...;

alter table rankings add column if not exists list text not null default 'General';
alter table rankings alter column link drop not null;
alter table rankings drop constraint if exists rankings_link_key;
create unique index if not exists rankings_list_link_key on rankings (list, link);
