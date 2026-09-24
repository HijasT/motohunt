// Frontend-only, pure functions: things the UI derives from listing rows rather
// than stores - duplicate grouping, deal scores, price changes and "not seen
// lately" detection. No Supabase calls here; see lib/supabase/queries.ts.
import type { BlockedModelRow, ListingRow, RankDropoutRow, ScrapeStatus } from "./supabase/types";
import { normLink } from "./adLink";

// ---- Duplicates ------------------------------------------------------------------

/** "X-Trail", "X TRAIL" and "xtrail" all normalize to "xtrail". */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function carKey(l: Pick<ListingRow, "make" | "model">): string {
  return `${norm(l.make)}|${norm(l.model)}`;
}

/**
 * Same make/model/year and odometer within ~1.5% (min 500 km) is almost
 * certainly the same car - two different cars of one model rarely share a year
 * AND a near-identical km reading. Price may differ (sites and reposts price
 * differently) but by at most 15% - erring towards showing two cards rather
 * than hiding a genuinely different car inside another's card.
 */
function looksLikeSameCar(a: ListingRow, b: ListingRow): boolean {
  if (a.year === null || a.year !== b.year) return false;
  if (a.km === null || b.km === null) return false;
  if (Math.abs(a.km - b.km) > Math.max(500, 0.015 * Math.max(a.km, b.km))) return false;
  if (a.price !== null && b.price !== null) {
    if (Math.abs(a.price - b.price) > 0.15 * Math.max(a.price, b.price)) return false;
  }
  return true;
}

export type ListingGroup = {
  /** The listing the card shows - the cheapest copy. */
  primary: ListingRow;
  /** Every other listing of the same car, cheapest first. */
  others: ListingRow[];
  keys: string[];
  /** Earliest first_seen_at across copies - a repost of an old car isn't "new". */
  firstSeenAt: string;
};

function byPriceThenRecent(a: ListingRow, b: ListingRow): number {
  const pa = a.price ?? Infinity;
  const pb = b.price ?? Infinity;
  if (pa !== pb) return pa - pb;
  return b.last_seen_at.localeCompare(a.last_seen_at);
}

/**
 * Collapses copies of the same car into one group. A listing joins a group only
 * if it matches *every* listing already in it - pairwise matching alone would
 * chain (39k ~ 45k ~ 47k) and swallow a different car.
 */
export function groupDuplicates(listings: ListingRow[]): ListingGroup[] {
  const clusters: ListingRow[][] = [];
  const byCar = new Map<string, ListingRow[][]>();

  for (const l of listings) {
    const key = carKey(l);
    const candidates = byCar.get(key) ?? [];
    const home = candidates.find((c) => c.every((m) => looksLikeSameCar(l, m)));
    if (home) {
      home.push(l);
    } else {
      const cluster = [l];
      clusters.push(cluster);
      byCar.set(key, [...candidates, cluster]);
    }
  }

  return clusters.map((group) => {
    const sorted = [...group].sort(byPriceThenRecent);
    return {
      primary: sorted[0],
      others: sorted.slice(1),
      keys: sorted.map((l) => l.unique_key),
      firstSeenAt: group.reduce((min, l) => (l.first_seen_at < min ? l.first_seen_at : min), group[0].first_seen_at),
    };
  });
}

// ---- Deal score ----------------------------------------------------------------------

export type Deal = {
  /** Price vs. the expected price for this car: -0.12 = 12% below market. */
  deltaPct: number;
  /** What comparable cars suggest this one should cost (mileage-adjusted when possible). */
  expected: number;
  comparables: number;
  mileageAdjusted: boolean;
  label: "great" | "good" | "fair" | "high";
};

const MIN_COMPARABLES = 3;
/** A km-vs-price line needs a few more points than a median to be trustworthy. */
const MIN_FOR_MILEAGE_FIT = 5;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function labelFor(deltaPct: number): Deal["label"] {
  if (deltaPct <= -0.1) return "great";
  if (deltaPct <= -0.04) return "good";
  if (deltaPct >= 0.1) return "high";
  return "fair";
}

/** Least-squares price = a + b·km. Null when km doesn't vary or the slope makes no sense (higher km, higher price). */
function fitPriceByKm(points: { km: number; price: number }[]): ((km: number) => number) | null {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.km, 0) / n;
  const my = points.reduce((s, p) => s + p.price, 0) / n;
  const sxx = points.reduce((s, p) => s + (p.km - mx) ** 2, 0);
  if (sxx === 0) return null;
  const b = points.reduce((s, p) => s + (p.km - mx) * (p.price - my), 0) / sxx;
  if (b >= 0) return null;
  const a = my - b * mx;
  return (km) => a + b * km;
}

/**
 * Deal score per listing unique_key. Comparables are other cars (duplicates
 * collapsed, so one car listed five times doesn't count five times) of the
 * same make/model within ±1 model year. The expected price is, in order of
 * preference: the median of those with similar mileage (±30%), a price-vs-km
 * line through all of them, or their plain median - so a 250,000 km car being
 * cheap doesn't read as a deal. Needs at least 3 comparables.
 */
export function computeDeals(market: ListingRow[]): Map<string, Deal> {
  const groups = groupDuplicates(market).filter((g) => g.primary.price !== null && g.primary.year !== null);
  const deals = new Map<string, Deal>();

  for (const g of groups) {
    const comps = groups.filter(
      (o) => o !== g && carKey(o.primary) === carKey(g.primary) && Math.abs(o.primary.year! - g.primary.year!) <= 1
    );
    if (comps.length < MIN_COMPARABLES) continue;

    const withKm = comps
      .filter((o) => o.primary.km !== null)
      .map((o) => ({ km: o.primary.km!, price: o.primary.price! }));
    const fit = withKm.length >= MIN_FOR_MILEAGE_FIT ? fitPriceByKm(withKm) : null;
    const med = median(comps.map((o) => o.primary.price!));

    for (const l of [g.primary, ...g.others]) {
      if (l.price === null) continue;
      // Best: cars with similar mileage. Next: the price-vs-km line. Last: plain median.
      const near =
        l.km === null
          ? []
          : withKm.filter((p) => Math.abs(p.km - l.km!) <= Math.max(20_000, 0.3 * l.km!)).map((p) => p.price);
      let expected: number;
      let basis: number;
      let mileageAdjusted = true;
      if (near.length >= MIN_COMPARABLES) {
        expected = median(near);
        basis = near.length;
      } else if (fit !== null && l.km !== null) {
        // Floor the line's estimate so an extreme odometer can't extrapolate to ~0.
        expected = Math.max(fit(l.km), 0.3 * med);
        basis = withKm.length;
      } else {
        expected = med;
        basis = comps.length;
        mileageAdjusted = false;
      }
      const deltaPct = (l.price - expected) / expected;
      deals.set(l.unique_key, { deltaPct, expected, comparables: basis, mileageAdjusted, label: labelFor(deltaPct) });
    }
  }
  return deals;
}

// ---- Price changes -------------------------------------------------------------------

export type PriceChange = { from: number; delta: number; at: string | null };

/** Change vs. the price when first seen (the number that matters when negotiating), or null if unchanged. */
export function priceChange(l: ListingRow): PriceChange | null {
  const from = l.original_price ?? null;
  if (from === null || l.price === null || from === l.price) return null;
  return { from, delta: l.price - from, at: l.price_changed_at ?? null };
}

// ---- Not seen lately -------------------------------------------------------------------

/** Two missed 6-hourly runs (+ slack for GitHub's cron jitter) before calling a listing gone. */
const GONE_AFTER_MS = 13 * 60 * 60 * 1000;

/**
 * True when the scraper has run successfully well after this listing was last
 * seen - likely sold or delisted. Measured against the last run (not the clock)
 * so a broken scraper doesn't make every listing look gone, and skipped when the
 * listing's own site failed in that run.
 */
export function isProbablyGone(l: ListingRow, scrape: ScrapeStatus | null): boolean {
  if (!scrape) return false;
  const source = scrape.sources.find((s) => s.name === l.source);
  if (!source || source.failedSearches > 0) return false;
  return new Date(scrape.at).getTime() - new Date(l.last_seen_at).getTime() > GONE_AFTER_MS;
}

/** A car listed on several sites is only gone once every copy is. */
export function isGroupGone(g: ListingGroup, scrape: ScrapeStatus | null): boolean {
  return [g.primary, ...g.others].every((l) => isProbablyGone(l, scrape));
}

// ---- Rankings ---------------------------------------------------------------------------

export { normLink };

/** True if any copy of this car is currently ranked. */
export function isGroupRanked(g: ListingGroup, rankedLinks: Set<string>): boolean {
  return [g.primary, ...g.others].some((l) => rankedLinks.has(normLink(l.link)));
}

// ---- Blocked models ---------------------------------------------------------------------

/** Same normalization as duplicate detection: "Renault Symbol" = "RENAULT SYMBOL" = "renault-symbol". */
export function isBlocked(l: Pick<ListingRow, "make" | "model">, blocked: BlockedModelRow[]): boolean {
  return blocked.some((b) => norm(b.make) === norm(l.make) && (b.model == null || norm(b.model) === norm(l.model)));
}

/** Is this exact make+model (or its whole make) already on the list? */
export function findBlock(make: string, model: string | null, blocked: BlockedModelRow[]): BlockedModelRow | undefined {
  return blocked.find(
    (b) => norm(b.make) === norm(make) && (b.model == null || (model != null && norm(b.model) === norm(model)))
  );
}

/** Every copy's canonical link -> its duplicate group, for matching ranks to scraped listings. */
export function groupsByLink(listings: ListingRow[]): Map<string, ListingGroup> {
  const map = new Map<string, ListingGroup>();
  for (const g of groupDuplicates(listings)) {
    for (const l of [g.primary, ...g.others]) map.set(normLink(l.link), g);
  }
  return map;
}

// ---- Rank candidates ------------------------------------------------------------------

/**
 * A car about to be ranked. Usually a scraped favorite, but a dropped-out car
 * MotoHunt doesn't scrape (e.g. a CarSwitch ad from the chat) can be ranked
 * again too, from the details saved with its old rank.
 */
export type RankCandidate = {
  link: string | null;
  title: string;
  price: number | null;
  km: number | null;
  note: string | null;
  /** Every URL this car is known by (duplicate copies) - used to clear its drop-out record. */
  links: string[];
};

export function candidateFromGroup(g: ListingGroup): RankCandidate {
  const l = g.primary;
  return {
    link: l.link,
    title: [l.year, l.make, l.model].filter(Boolean).join(" "),
    price: l.price,
    km: l.km,
    note: null,
    links: [g.primary, ...g.others].map((x) => x.link),
  };
}

/** Re-ranks the exact ad that dropped out, keeping its title/note; live price/km win if it's scraped. */
export function candidateFromDropout(row: RankDropoutRow, g: ListingGroup | undefined): RankCandidate {
  const live = g && row.link ? [g.primary, ...g.others].find((l) => normLink(l.link) === normLink(row.link!)) : undefined;
  return {
    link: row.link,
    title: row.title ?? (g ? candidateFromGroup(g).title : "Car"),
    price: live?.price ?? row.price,
    km: live?.km ?? row.km,
    note: row.note,
    links: [...(row.link ? [row.link] : []), ...(g ? [g.primary, ...g.others].map((x) => x.link) : [])],
  };
}
