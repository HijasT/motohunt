# Dev notes — how each site is actually scraped

Everything below was checked against the live sites (dates noted). The point of this
file is so the next person doesn't have to re-derive it.

**The general approach**: read the site's schema.org JSON-LD, not its CSS classes.
All of these sites publish structured listing data for Google's benefit, which gives
them a reason to keep it stable — unlike class names, which change on any redesign.
Where a site has no JSON-LD (Automall), call the same JSON API its own frontend calls.

Every scraper re-checks its results with `matchesFilters()` before returning them.
Several of these sites **silently ignore a query parameter they don't recognise and
return the unfiltered list**, so server-side filtering alone is not trustworthy.

---

## Dubizzle — `scrapers/dubizzle.ts` ✅ verified 2026-09-17

- **Bot protection**: Imperva. A cold request to a search URL (curl *or* headless
  Chromium) returns a ~1 KB `Pardon Our Interruption` page. Loading
  `https://uae.dubizzle.com/` first and waiting ~7s clears the challenge; search
  pages then return the full ~1.5 MB document for the rest of the session.
  This is why the scraper calls `warmUp()` and why it needs a real browser.
- **URL shape**: `/motors/used-cars/<make>/<model>/` — make and model are path
  segments, both optional (`/motors/used-cars/nissan/` works fine).
- **Query params** (all verified to actually filter):
  | filter | param |
  |---|---|
  | max price | `price__lte` |
  | max mileage | `kilometers__lte` |
  | min year | `year__gte` |
  | max year | `year__lte` |
  | page | `page` |
- **Data**: `<script type="application/ld+json">` block with
  `"@type": ["SearchResultsPage", "Product"]`. Its `mainEntity` is an `ItemList`
  of `Vehicle` nodes carrying `brand.name`, `model`, `vehicleModelDate`,
  `offers.price`, `mileageFromOdometer.value`, `description` and `url`.
  ~26 listings per page. The sibling `offers` AggregateOffer gives the total
  match count, which is handy when checking filters by hand.

## CarSwitch — `scrapers/carswitch.ts` ✅ verified 2026-09-17

- No bot protection, but it **soft-blocks on rapid requests** — roughly 15 hits in
  a couple of minutes started returning empty responses. Keep the page count low.
- **URL**: `https://carswitch.com/uae/used-cars/search`
- **Query params**: only `makes` and `models` (both **plural**; `make`/`model`
  singular are accepted and ignored) plus `page`. No working param was found for
  price, mileage or year — those are applied locally.
- **Make slugs are CarSwitch's own**, and an unknown slug returns the *unfiltered*
  list. Confirmed slugs come from their own nav links, e.g. `mercedes` (not
  `mercedes-benz`), `range-rover` (not `land-rover`). `MAKE_SLUG_ALIASES` in the
  scraper maps the common ones; add to it as needed.
- **Data**: `"@type": "ItemList"` JSON-LD, ~24 entries per page, each an `ItemPage`
  whose **`mainEntity`** (not `item`) is the `Product`/`Car`. Server-rendered, so
  no waiting needed. Pages past the last result have no ItemList at all — that's
  the pagination stop signal.

## Al Futtaim Automall — `scrapers/automall.ts` ✅ verified 2026-09-17

- The listing grid is client-rendered; the HTML has no usable markup and the SSR
  JSON-LD is capped at the first 50 cars, so we use their public BFF API instead —
  the same endpoints `www.automall.ae`'s own JavaScript calls.
- **Token**: `GET /bff/dx/guest-access-token` → `{ access_token }` (anonymous, no
  signup). Required as `authorization: Bearer <token>` on the call below.
- **Search**: `GET /bff/v2/vehicles?q=<query>&fields=<fields>&sort=price=1`
  - `paging-info` request header: `start-index=0|no-of-records=N` (accepts up to 2000)
  - the **response** `paging-info` header reports `total-count`
  - `q` uses `|` as AND and supports `>`/`<`/`=`, e.g.
    `type=auto_used_automobiles|price>0|attributes.auto_sap_vehicle_status.values.EN=AV`.
    Filters on `price<N`, `attributes.auto_sap_model_year.values.EN>=N` and
    `attributes.auto_sap_make.values.EN=TOYOTA` all work.
  - `fields` renames attributes with `as`, e.g.
    `attributes.auto_sap_odometer.values.EN as odometer`.
  - **`q` and `fields` must not be percent-encoded** — the `|`, `>` and `=` are syntax.
- **Why we filter locally anyway**: total used stock is only ~270 cars, so one
  request gets everything. Their make values are un-separated uppercase
  (`MERCEDESBENZ`) and model values are dealer shorthand (`PRADO`, `COROLLA CROSS`),
  so matching them server-side would turn a spelling mismatch into a silent zero.
- **Detail page**: `https://www.automall.ae/en/used-cars-shop/<id>`, where `id` is
  the VIN.
- Note: the site's config also references `aedevdxamb01.corp.al-futtaim.com` and
  `aeautomall-new.corp.al-futtaim.com`. Those are internal hosts, unreachable from
  the public internet — use the `www.automall.ae/bff/...` proxy paths.

## Cars24 — `scrapers/cars24.ts` ✅ verified 2026-09-17

- No bot protection; a plain `fetch()` works, no browser needed.
- **URL**: `https://www.cars24.ae/buy-used-<make>-<model>-cars-dubai/` (model
  omitted if not given, make omitted too for a budget-only search →
  `/buy-used-cars-dubai/`). Despite the `-dubai` suffix this is their general
  UAE catalog — a Sharjah-listed car showed up in it during testing. A
  `-uae`-suffixed variant of these URLs also exists but isn't server-rendered
  with any data, so it's not used.
- **No working price/km/year param was found** (query param and JSON-LD
  approaches don't apply here — see below), so those are enforced locally by
  `matchesFilters()`, same as CarSwitch.
- **No pagination beyond the first server-rendered batch** (~15-40 cars per
  URL). Loading more is a client-side "load more" fetch, not a `?page=` param;
  capturing that endpoint wasn't attempted. Fine for a comparison tool, but a
  real gap if you need Cars24's *entire* inventory for a make.
- **Data**: no schema.org JSON-LD at all. The listing cards are server-rendered,
  but the data travels in Next.js App Router's internal RSC "Flight" wire
  format — `self.__next_f.push([1, "<id>:<json>\n<id>:<json>..."])` script
  tags, all sharing one id namespace across the page, with `"$<id>"` acting as
  a reference to another entry. `lib/rscFlight.ts` parses this.
  - **This is not a stable public contract** — it's React/Next.js internals,
    subject to change with their framework version, unlike JSON-LD which is
    aimed at search engines and much more likely to stay put. If Cars24 starts
    coming back empty, this is the first thing to suspect.
  - **Gotcha that cost real debugging time**: each `push()` is a fixed-size
    fragment (~2KB) of *one continuous stream*, not a self-contained unit — a
    single field (an SEO description block, say) can be long enough to span
    several pushes and get cut mid-value if you parse each push independently.
    `parseFlightStore()` concatenates every push's unescaped text first, in
    document order, before splitting on `<id>:` boundaries. The boundary
    search itself also tracks JSON nesting depth and string state (not a
    naive newline split), because a value can legitimately contain a raw
    newline that isn't a record boundary.
  - Prefer `listingPriceV2` over `listingPrice` for the price - both carry the
    same number, but `listingPrice` was the one actually observed truncated
    before the fix above; keeping the fallback costs nothing.
- **Fields used**: `make`, `model`, `year`, `carName`, `fuelType`,
  `cdpRelativeUrl` (append to `https://www.cars24.ae/`), `appointmentId`
  (their listing ID), `odometer.value`, `listingPriceV2.value`.

## YallaMotors — `scrapers/yallamotors.ts` ⚠️ UNVERIFIED

**Could not be reached to verify.** As of 2026-09-17:

- `uae.yallamotors.com` — the host the original plan assumed — **does not resolve**
  (NXDOMAIN on public DNS).
- `yallamotors.com` and `www.yallamotors.com` resolve to `130.61.42.24`, which
  presents a certificate for a different name and answers **403 Forbidden** (bare
  nginx) to every request, over both HTTP and HTTPS, with or without browser
  headers. That looks like an origin server behind geo-restriction or a WAF.

The scraper is therefore written to fail safe rather than to guess loudly: it tries
several plausible URL shapes, keeps the first that returns listings, reads JSON-LD
permissively, and runs everything through `matchesFilters()` so it cannot emit
non-matching rows. If nothing works it logs a warning and returns `[]`.

**To finish it**, from a network that can reach the site (e.g. inside the UAE):

1. `npm run verify` and see whether YallaMotors returns anything.
2. If not, open a used-car search in a browser, note the real path and query params,
   and update `candidateUrls()`.
3. Check whether the page has `<script type="application/ld+json">` with an
   `ItemList`. If it does, `extractVehicles()` should already handle it. If not,
   that is the one site that will need real CSS selectors.

## Al Aweer Auto Market — not built, by design

`alaweerautomarket.com` is a **pre-launch waitlist page**: "Dubai's Largest Auto
Market — Online Soon", with register-as-dealer / register-as-customer forms and no
inventory whatsoever. `alaweerauto.com` does not resolve. There is nothing to
scrape yet. Revisit once they launch; until then a scraper could only return an
empty list.

---

## Checking for drift

`npm run verify` runs every scraper against the live sites with the configured
filters and prints counts plus sample rows, without needing Supabase credentials.
Run it when the app's Results tab looks wrong — it distinguishes "no car matched"
from "that site changed".
