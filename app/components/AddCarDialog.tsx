"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ManualCarInput } from "../../lib/supabase/queries";
import { lookupOrigin } from "../../lib/originLookup";
import { XIcon } from "./icons";
import { errorMessage, ghostButtonClass, inputClass, panelClass, primaryButtonClass } from "./ui";

type Props = {
  onCancel: () => void;
  onSave: (car: ManualCarInput) => Promise<void>;
};

const labelClass = "block text-xs font-medium text-neutral-600 dark:text-neutral-400";

/** "x-trail" -> "X-Trail", "asx" -> "ASX", "land-cruiser" -> "Land-Cruiser". */
function pretty(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w.length <= 3 && !/^\d+$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("-");
}

export function sourceFor(link: string): string {
  try {
    const host = new URL(link).hostname.replace(/^www\./, "");
    if (host.endsWith("dubizzle.com")) return "Dubizzle";
    if (host === "carswitch.com") return "CarSwitch";
    if (host === "cars24.ae") return "Cars24";
    if (host.endsWith("automall.ae")) return "Al Futtaim Automall";
    if (host.endsWith("yallamotors.com")) return "YallaMotors";
    return host;
  } catch {
    return "Manual";
  }
}

/** Best-effort make/model/year from the ad URL; anything it can't read stays empty. */
function guessFromLink(link: string): { make?: string; model?: string; year?: string } {
  let path: string;
  try {
    path = new URL(link).pathname;
  } catch {
    return {};
  }
  // Dubizzle: /motors/used-cars/<make>/<model>/<posted yyyy>/... (that year is the posting date, not the car's)
  let m = path.match(/\/used-cars\/([^/]+)\/([^/]+)\//);
  if (m) return { make: pretty(m[1]), model: pretty(m[2]) };
  // CarSwitch: /<city>/used-car/<make>/<model>/<model year>/<id>
  m = path.match(/\/used-car\/([^/]+)\/([^/]+)\/(\d{4})\//);
  if (m) return { make: pretty(m[1]), model: pretty(m[2]), year: m[3] };
  // Cars24: /buy-used-<make>-<model...>-<year>-cars-<city>-<id>/
  m = path.match(/\/buy-used-([a-z0-9]+)-([a-z0-9-]+?)-(\d{4})-cars-/);
  if (m) return { make: pretty(m[1]), model: pretty(m[2]), year: m[3] };
  return {};
}

function parseNum(s: string): number | null | "invalid" {
  const cleaned = s.replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : "invalid";
}

/** Add a car to Favorites by hand - for ads MotoHunt's saved searches don't pick up. */
export function AddCarDialog({ onCancel, onSave }: Props) {
  const [link, setLink] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [price, setPrice] = useState("");
  const [km, setKm] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  // Pasting a link fills make/model/year. Fields filled that way follow the link
  // (a different link replaces or clears them); anything you typed yourself stays.
  const autoFilled = useRef(new Set<"make" | "model" | "year">());
  const setters = { make: setMake, model: setModel, year: setYear };
  const current = { make, model, year };

  function onLinkChange(value: string) {
    setLink(value);
    setError(null);
    const guess = guessFromLink(value.trim());
    for (const field of ["make", "model", "year"] as const) {
      const mine = current[field] !== "" && !autoFilled.current.has(field);
      if (mine) continue;
      const next = guess[field] ?? "";
      setters[field](next);
      if (next) autoFilled.current.add(field);
      else autoFilled.current.delete(field);
    }
  }

  /** Typing in a field makes it yours - later link changes leave it alone. */
  const typed = (field: "make" | "model" | "year", set: (v: string) => void) => (v: string) => {
    autoFilled.current.delete(field);
    setError(null);
    set(v);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const url = link.trim();
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) throw new Error();
    } catch {
      setError("Paste the full ad link (starting with https://).");
      return;
    }
    if (!make.trim() || !model.trim()) {
      setError("Make and model are needed.");
      return;
    }
    const nums = { year: parseNum(year), price: parseNum(price), km: parseNum(km) };
    if (Object.values(nums).includes("invalid")) {
      setError("Year, price and km must be numbers.");
      return;
    }
    setBusy(true);
    try {
      await onSave({
        source: sourceFor(url),
        link: url,
        make: make.trim(),
        model: model.trim(),
        year: nums.year as number | null,
        price: nums.price as number | null,
        km: nums.km as number | null,
        description: notes.trim() || null,
        countryOfMake: lookupOrigin(make.trim()),
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-car-title"
        className={`${panelClass} w-full max-w-md shadow-xl`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <div>
            <h2 id="add-car-title" className="font-semibold">
              Add a car to Favorites
            </h2>
            <p className="text-sm text-neutral-500">For an ad your saved searches didn&apos;t pick up.</p>
          </div>
          <button type="button" className={ghostButtonClass} onClick={onCancel} aria-label="Close" disabled={busy}>
            <XIcon />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 px-4 py-3">
          <label className={`${labelClass} col-span-2`}>
            Ad link
            <input
              ref={first}
              className={`${inputClass} mt-1`}
              value={link}
              onChange={(e) => onLinkChange(e.target.value)}
              placeholder="https://dubai.dubizzle.com/motors/used-cars/…"
              inputMode="url"
            />
          </label>
          <label className={labelClass}>
            Make
            <input className={`${inputClass} mt-1`} value={make} onChange={(e) => typed("make", setMake)(e.target.value)} placeholder="Nissan" />
          </label>
          <label className={labelClass}>
            Model
            <input className={`${inputClass} mt-1`} value={model} onChange={(e) => typed("model", setModel)(e.target.value)} placeholder="X-Trail" />
          </label>
          <label className={labelClass}>
            Year
            <input className={`${inputClass} mt-1`} value={year} onChange={(e) => typed("year", setYear)(e.target.value)} inputMode="numeric" placeholder="2021" />
          </label>
          <label className={labelClass}>
            Price (AED)
            <input className={`${inputClass} mt-1`} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" placeholder="45,000" />
          </label>
          <label className={labelClass}>
            Mileage (km)
            <input className={`${inputClass} mt-1`} value={km} onChange={(e) => setKm(e.target.value)} inputMode="numeric" placeholder="80,000" />
          </label>
          <label className={labelClass}>
            Notes <span className="font-normal text-neutral-400">(optional)</span>
            <input className={`${inputClass} mt-1`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="GCC, 1st owner" />
          </label>
        </div>

        {error && (
          <p className="mx-4 mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <button type="button" className={ghostButtonClass} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={primaryButtonClass} disabled={busy}>
            {busy ? "Adding…" : "Add to Favorites"}
          </button>
        </div>
      </form>
    </div>
  );
}
