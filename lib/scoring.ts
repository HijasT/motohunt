// Frontend-only, pure: the MotoHunt scoring rubric (rules.txt / Scoring Spec v1).
// MotoHunt computes a raw 0-50 score + per-criterion breakdown; final list placement
// stays manual. Only Year, Mileage/Age and Price are truly in the scraped data; Spec,
// Trim, Warranty and accident status are read from the ad text when stated; Fuel,
// Reliability, Longevity and Maintenance come from the platform-knowledge tables below.
// Every criterion carries a `basis` so an estimate is never mistaken for a hard fact.
import type { ListingRow } from "./supabase/types";
import { isBlacklisted, specRegion } from "./listingInsights";

/** How a criterion's score was arrived at - shown next to it so estimates are visible. */
export type Basis = "auto" | "text" | "estimated" | "manual";

export type CriterionScore = { n: number; label: string; score: number; max: number; basis: Basis; note?: string };

export type CarScore = {
  /** Passes every Stage-1 hard exclude (applies to all lists). */
  eligible: boolean;
  excludeReasons: string[];
  /** Fails only the age>10 / km>150k caps, so eligible for the High-Mileage/Budget list alone. */
  budgetOnly: boolean;
  budgetReasons: string[];
  total: number; // 0-50
  criteria: CriterionScore[];
  /** For the manual accident-history penalty. */
  accident: "free" | "reported" | null;
};

const clamp5 = (n: number) => Math.max(0, Math.min(5, n));
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const currentYear = () => new Date().getFullYear();

/** Chinese brands (squashed make). EVs/PHEVs and these makes are held to a 3-year age cap. */
const CHINESE_MAKES = new Set([
  "byd", "jetour", "geely", "chery", "changan", "gwm", "greatwall", "haval", "mg", "maxus",
  "omoda", "jaecoo", "tank", "exeed", "hongqi", "lynkco", "zeekr", "deepal", "bestune",
  "dongfeng", "gac", "jac", "ora", "xpeng", "nio", "denza", "forthing", "foton", "baic",
  "wuling", "seres", "voyah", "avatr",
]);

// ---- Platform-knowledge tables (keyed by squashed make) ------------------------------
// Rough, deliberately conservative defaults; tune as real-world data comes in.
// ponytail: per-make, not per-model/generation - a model-level table is the upgrade path if it matters.

const RELIABILITY: Record<string, number> = {
  toyota: 5, lexus: 5, honda: 5, mazda: 4, suzuki: 4, hyundai: 4, kia: 4, genesis: 4,
  nissan: 3, mitsubishi: 3, subaru: 3, ford: 3, chevrolet: 3, gmc: 3, cadillac: 3,
  bmw: 3, mercedesbenz: 3, audi: 3, volkswagen: 3, porsche: 4, volvo: 3, mini: 3,
  jeep: 2, dodge: 2, chrysler: 2, landrover: 2, rangerover: 2, jaguar: 2, maserati: 2,
};
const LONGEVITY: Record<string, number> = {
  toyota: 5, lexus: 5, honda: 4, mazda: 4, suzuki: 3, hyundai: 4, kia: 3, genesis: 4,
  nissan: 3, mitsubishi: 4, subaru: 3, ford: 3, chevrolet: 3, gmc: 3, cadillac: 3,
  bmw: 3, mercedesbenz: 3, audi: 3, volkswagen: 3, porsche: 4, volvo: 4, mini: 3,
  jeep: 2, dodge: 2, chrysler: 2, landrover: 2, rangerover: 2, jaguar: 2, maserati: 2,
};
// Maintenance cost: Low cost = 5, High cost = 1.
const MAINTENANCE: Record<string, number> = {
  toyota: 5, honda: 5, suzuki: 5, mazda: 4, hyundai: 4, kia: 4, nissan: 4, mitsubishi: 4,
  subaru: 3, lexus: 4, genesis: 3, ford: 3, chevrolet: 3, gmc: 3, cadillac: 2,
  bmw: 1, mercedesbenz: 1, audi: 1, volkswagen: 2, porsche: 1, volvo: 2, mini: 2,
  jeep: 2, dodge: 2, chrysler: 2, landrover: 1, rangerover: 1, jaguar: 1, maserati: 1,
};

/** Brand bonuses (Spec v1 Stage 3), already ≤ +2 total per make. */
const BRAND_BONUS: Record<string, Partial<Record<"reliability" | "longevity" | "maintenance", number>>> = {
  toyota: { reliability: 1, maintenance: 1 },
  lexus: { reliability: 1, maintenance: 1 },
  hyundai: { reliability: 1, maintenance: 1 },
  mitsubishi: { longevity: 1, maintenance: 1 },
  kia: { maintenance: 1 },
  nissan: { maintenance: 1 },
};

// ---- Stage 1: eligibility ------------------------------------------------------------

/** First "X.XL" in the ad text, e.g. "2.0L Turbo" -> 2. Null when none stated. */
function engineLitres(desc: string): number | null {
  const m = desc.match(/(\d(?:\.\d)?)\s*(?:l\b|liter|litre)/i) || desc.match(/\b(\d\.\d)\b/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n >= 0.6 && n <= 8 ? n : null;
}
const isTurbo = (d: string) => /turbo|t-gdi|tsi|tfsi|ecoboost|supercharg/i.test(d);
const isHybrid = (d: string) => /hybrid|phev/i.test(d);
const isElectric = (d: string) => /\belectric\b|\bev\b|\bbev\b/i.test(d) && !isHybrid(d);
const isSevenSeat = (d: string) => /\b7[\s-]*seat|seven[\s-]*seat/i.test(d);

function eligibility(
  l: ListingRow,
  desc: string,
  mk: string,
  model: string
): Pick<CarScore, "eligible" | "excludeReasons" | "budgetOnly" | "budgetReasons"> {
  const excludeReasons: string[] = [];
  const budgetReasons: string[] = [];
  const age = l.year == null ? null : currentYear() - l.year;

  if (isBlacklisted(l)) excludeReasons.push("Blacklisted model");
  if (l.km != null && l.km > 225_000) excludeReasons.push("Over 225,000 km");
  if (mk === "hyundai" && model.includes("sonata") && l.year === 2023) excludeReasons.push("2023 Sonata (DN8) fuel-tank recall");

  const litres = engineLitres(desc);
  if (litres != null && litres < 2.0 && !isTurbo(desc) && !isElectric(desc))
    excludeReasons.push(`Engine ${litres}L (< 2.0L, not turbocharged)`);

  // X-Trail 7-seat claims are listing errors, not a real trim - don't exclude on those.
  if (isSevenSeat(desc) && !(mk === "nissan" && model.includes("xtrail"))) excludeReasons.push("7-seat vehicle");

  // EVs/PHEVs and Chinese-brand cars must be <= 3 years old (older => hard exclude).
  const youngOnly = isElectric(desc) || /phev|plug-?in/i.test(desc) || CHINESE_MAKES.has(mk);
  if (youngOnly && age != null && age > 3)
    excludeReasons.push(`${CHINESE_MAKES.has(mk) ? "Chinese-brand" : "EV/PHEV"} over 3 years old (${l.year})`);

  // Caps that only bar the non-budget lists.
  if (age != null && age > 10) budgetReasons.push(`Over 10 years old (${l.year})`);
  if (l.km != null && l.km > 150_000) budgetReasons.push("Over 150,000 km");

  return {
    eligible: excludeReasons.length === 0,
    excludeReasons,
    budgetOnly: excludeReasons.length === 0 && budgetReasons.length > 0,
    budgetReasons,
  };
}

// ---- Stage 2 criteria ----------------------------------------------------------------

function yearScore(year: number | null): number {
  if (year == null) return 0;
  if (year >= 2023) return 5;
  if (year === 2022) return 4;
  if (year === 2021) return 3;
  if (year === 2020) return 2;
  if (year >= 2017) return 1;
  return 0;
}

function mileageScore(km: number | null): number {
  if (km == null) return 0;
  if (km < 50_000) return 5;
  if (km < 75_000) return 4;
  if (km < 100_000) return 3;
  if (km < 125_000) return 2;
  if (km <= 150_000) return 1;
  return 0;
}

function priceScore(price: number | null): number {
  if (price == null) return 0;
  if (price < 25_000) return 5;
  if (price < 30_000) return 4;
  if (price < 35_000) return 3;
  if (price < 40_000) return 2;
  if (price <= 50_000) return 1;
  return 0;
}

function specScore(l: ListingRow, mk: string): { score: number; basis: Basis; note?: string } {
  const region = specRegion(l);
  if (region === "GCC") return { score: 5, basis: "text", note: "GCC" };
  if (region === "American") {
    const rarity = mk === "dodge" || mk === "lexus"; // US-spec Dodge/Lexus rarity exception
    return { score: rarity ? 4 : 3, basis: "text", note: rarity ? "US (rarity +1)" : "US" };
  }
  if (region) return { score: 1, basis: "text", note: region };
  return { score: 3, basis: "manual", note: "spec not stated" };
}

function fuelScore(mk: string, model: string, desc: string): { score: number; basis: Basis } {
  if (isHybrid(desc) || isElectric(desc)) return { score: 5, basis: "text" };
  const thirsty = /landcruiser|patrol|tahoe|yukon|suburban|expedition|armada|sequoia|lx570|lx600|gx4|gx5|qx80|g63|wrangler|raptor|hemi|v8|nismo/;
  if (thirsty.test(model) || thirsty.test(squash(desc))) return { score: 2, basis: "estimated" };
  const economy = new Set(["toyota", "honda", "hyundai", "kia", "mazda", "suzuki", "mitsubishi", "nissan"]);
  const thirstyMake = new Set(["bmw", "mercedesbenz", "audi", "porsche", "landrover", "rangerover", "jaguar", "dodge", "jeep", "cadillac", "gmc", "chrysler", "maserati"]);
  if (economy.has(mk)) return { score: 4, basis: "estimated" };
  if (thirstyMake.has(mk)) return { score: 2, basis: "estimated" };
  return { score: 3, basis: "estimated" };
}

function trimScore(desc: string): { score: number; basis: Basis } {
  const d = desc.toLowerCase();
  if (/full option|fully loaded|top of the range|platinum|limited|titanium|\bgxr\b|\bvxr\b|signature|prestige|sahara|denali|\bawd limited\b/.test(d))
    return { score: 5, basis: "text" };
  if (/\bbase\b|standard|\bgl\b|\ble\b|\bs trim\b|entry/.test(d)) return { score: 1, basis: "text" };
  return { score: 3, basis: "manual" };
}

function warrantyScore(l: ListingRow, desc: string): { score: number; basis: Basis; note?: string } {
  const d = desc.toLowerCase();
  const warranty = /warrant/.test(d);
  const sixPlus =
    /(?:[6-9]|1\d|2[0-4])\s*month/.test(d) || /\b\d+\s*year/.test(d) || /till\s*20(?:2[7-9]|[3-9]\d)/.test(d);
  const service = /service (?:history|record|contract)|fully serviced|full service|agency maintained|dealer service/.test(d);
  const isCars24 = squash(l.source).includes("cars24");
  // CARS24 counts as full warranty only when 6+ months is explicit; otherwise service-history tier.
  if (warranty && sixPlus && !(isCars24 && !sixPlus)) return { score: 5, basis: "text", note: "warranty 6mo+" };
  if (service || (warranty && !sixPlus)) return { score: 3, basis: "text", note: "service history / short warranty" };
  return { score: 1, basis: "manual", note: "none stated" };
}

function accidentStatus(desc: string): CarScore["accident"] {
  const d = desc.toLowerCase();
  if (/no accident|accident[-\s]?free|clean (?:history|title|car)|not accidented/.test(d)) return "free";
  if (/accident|collision|repaired|bodywork/.test(d)) return "reported";
  return null;
}

// ---- Stage 3 modifiers ---------------------------------------------------------------

/** Platform penalties (Spec v1 Stage 3), returned as deltas to apply before clamping. */
function platformPenalty(mk: string, model: string, year: number | null) {
  const pen = { reliability: 0, longevity: 0, maintenance: 0 };
  if (mk === "nissan" && model.includes("xtrail")) {
    pen.reliability -= 1; // Xtronic CVT (T32)
    pen.longevity -= 1;
  }
  if (mk === "dodge" && (model.includes("charger") || model.includes("challenger"))) {
    pen.reliability -= 1; // TIPM/ZF8
    if (year != null && year < 2020) pen.maintenance -= 1; // full penalty only pre-2020
  }
  return pen;
}

// ---- Public entry point --------------------------------------------------------------

export function scoreListing(l: ListingRow): CarScore {
  const desc = l.description ?? "";
  const mk = squash(l.make);
  const model = squash(l.model);
  const elig = eligibility(l, desc, mk, model);

  const bonus = BRAND_BONUS[mk] ?? {};
  const pen = platformPenalty(mk, model, l.year);

  const spec = specScore(l, mk);
  const fuel = fuelScore(mk, model, desc);
  const trim = trimScore(desc);
  const warranty = warrantyScore(l, desc);

  // #3: worse of the mileage band and the age band (age band reuses the Year tiers).
  const mileageSub = mileageScore(l.km);
  const ageSub = yearScore(l.year);
  const mileageAge = Math.min(mileageSub, ageSub);

  const reliability = clamp5((RELIABILITY[mk] ?? 3) + (bonus.reliability ?? 0) + pen.reliability);
  const longevity = clamp5((LONGEVITY[mk] ?? 3) + (bonus.longevity ?? 0) + pen.longevity);
  const maintenance = clamp5((MAINTENANCE[mk] ?? 3) + (bonus.maintenance ?? 0) + pen.maintenance);

  const modNote = (base: number, delta: number) => (delta ? `base ${base}${delta > 0 ? ` +${delta}` : ` ${delta}`}` : undefined);

  const criteria: CriterionScore[] = [
    { n: 1, label: "Spec", score: spec.score, max: 5, basis: spec.basis, note: spec.note },
    { n: 2, label: "Year", score: yearScore(l.year), max: 5, basis: l.year == null ? "manual" : "auto", note: l.year?.toString() },
    { n: 3, label: "Mileage/Age", score: mileageAge, max: 5, basis: l.km == null && l.year == null ? "manual" : "auto", note: `min(km ${mileageSub}, age ${ageSub})` },
    { n: 4, label: "Fuel", score: fuel.score, max: 5, basis: fuel.basis },
    { n: 5, label: "Trim", score: trim.score, max: 5, basis: trim.basis },
    { n: 6, label: "Reliability", score: reliability, max: 5, basis: "estimated", note: modNote(RELIABILITY[mk] ?? 3, (bonus.reliability ?? 0) + pen.reliability) },
    { n: 7, label: "Longevity", score: longevity, max: 5, basis: "estimated", note: modNote(LONGEVITY[mk] ?? 3, (bonus.longevity ?? 0) + pen.longevity) },
    { n: 8, label: "Maintenance", score: maintenance, max: 5, basis: "estimated", note: modNote(MAINTENANCE[mk] ?? 3, (bonus.maintenance ?? 0) + pen.maintenance) },
    { n: 9, label: "Price", score: priceScore(l.price), max: 5, basis: l.price == null ? "manual" : "auto", note: l.price == null ? undefined : `AED ${l.price}` },
    { n: 10, label: "Warranty/Service", score: warranty.score, max: 5, basis: warranty.basis, note: warranty.note },
  ];

  return {
    ...elig,
    total: criteria.reduce((s, c) => s + c.score, 0),
    criteria,
    accident: accidentStatus(desc),
  };
}

// ---- Self-check (run: npx tsx lib/scoring.ts) ----------------------------------------

function selfCheck() {
  const base: ListingRow = {
    id: "1", unique_key: "k", source: "Dubizzle", make: "Toyota", model: "RAV4", year: 2021,
    price: 32_000, km: 80_000, description: "GCC specs, full service history", link: "x",
    country_of_make: "Japan", first_seen_at: "", last_seen_at: "", expires_at: "",
  };
  const rav4 = scoreListing(base);
  console.assert(rav4.eligible, "RAV4 should be eligible");
  console.assert(rav4.criteria[0].score === 5, "GCC spec = 5");
  console.assert(rav4.criteria[1].score === 3, "2021 = 3");
  console.assert(rav4.criteria[2].score === 3, "min(km 3, age 3) = 3");
  console.assert(rav4.criteria[5].score === 5, "Toyota reliability 5(+1 bonus clamped)");
  console.assert(rav4.criteria[8].score === 3, "32k price = 3");

  // Blacklist + caps
  console.assert(!scoreListing({ ...base, model: "C-HR" }).eligible, "C-HR blacklisted");
  console.assert(!scoreListing({ ...base, make: "Hyundai", model: "Sonata", year: 2023 }).eligible, "2023 Sonata out");
  console.assert(!scoreListing({ ...base, km: 230_000 }).eligible, "230k km out");
  console.assert(scoreListing({ ...base, km: 160_000 }).budgetOnly, "160k km = budget only");
  console.assert(scoreListing({ ...base, year: 2010 }).budgetOnly, "2010 (>10yr) = budget only");

  // X-Trail CVT penalty, Honda Accord year-range blacklist
  const xtrail = scoreListing({ ...base, make: "Nissan", model: "X-Trail", description: "GCC" });
  console.assert(xtrail.criteria[5].score === clamp5(3 - 1), "X-Trail reliability -1");
  console.assert(!scoreListing({ ...base, make: "Honda", model: "Accord", year: 2019 }).eligible, "2019 Accord blacklisted");
  console.assert(scoreListing({ ...base, make: "Honda", model: "Accord", year: 2024 }).eligible, "2024 Accord fine");

  // User-call blacklist: Yaris/HR-V any year, Jetour X50 only (X70 is fine).
  console.assert(!scoreListing({ ...base, make: "Toyota", model: "Yaris" }).eligible, "Yaris blacklisted");
  console.assert(!scoreListing({ ...base, make: "Honda", model: "HR-V" }).eligible, "HR-V blacklisted");
  console.assert(!scoreListing({ ...base, make: "Jetour", model: "X50 Plus", year: 2024 }).eligible, "Jetour X50 blacklisted");
  console.assert(scoreListing({ ...base, make: "Jetour", model: "X70", year: 2024 }).eligible, "Jetour X70 fine (<=3yr)");

  // EV/PHEV/Chinese-brand 3-year age cap.
  console.assert(!scoreListing({ ...base, make: "BYD", model: "Seal", year: 2021, description: "electric GCC" }).eligible, "BYD 2021 (>3yr) out");
  console.assert(scoreListing({ ...base, make: "BYD", model: "Seal", year: 2024, description: "electric GCC" }).eligible, "BYD 2024 (<=3yr) ok");
  console.assert(!scoreListing({ ...base, make: "Jetour", model: "X70", year: 2022, description: "GCC" }).eligible, "Jetour 2022 (>3yr) out");
  console.assert(scoreListing({ ...base, make: "Toyota", model: "Camry", year: 2019, description: "GCC" }).eligible, "non-Chinese ICE 2019 fine");
  console.log("scoring self-check passed");
}

if (process.argv[1] && /scoring\.ts$/.test(process.argv[1])) selfCheck();
