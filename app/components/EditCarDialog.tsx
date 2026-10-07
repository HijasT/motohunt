"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ListingRow } from "../../lib/supabase/types";
import type { ListingOverride } from "../../lib/supabase/queries";
import { specRegion } from "../../lib/listingInsights";
import { XIcon } from "./icons";
import { ghostButtonClass, inputClass, panelClass, primaryButtonClass } from "./ui";

/** Spec regions the scorer understands (criterion #1); "" clears the override and re-reads the ad. */
const SPEC_OPTIONS = ["GCC", "American", "European", "Japanese", "Canadian", "Korean", "Chinese"];

type Props = {
  listing: ListingRow;
  onCancel: () => void;
  onSave: (ov: ListingOverride) => Promise<void>;
};

const labelClass = "block text-xs font-medium text-neutral-600 dark:text-neutral-400";
const toNum = (s: string) => (s.trim() === "" ? null : Number(s));

/** Corrects a favorite's spec, km and price. Edits survive re-scrapes (stored as overrides). */
export function EditCarDialog({ listing, onCancel, onSave }: Props) {
  // Prefill the explicit override only; the detected spec is shown as the "Auto" hint.
  const [spec, setSpec] = useState(listing.spec ?? "");
  const [km, setKm] = useState(listing.km?.toString() ?? "");
  const [price, setPrice] = useState(listing.price?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const firstField = useRef<HTMLSelectElement>(null);

  useEffect(() => firstField.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const detected = specRegion({ description: listing.description, spec: null });
  const title = [listing.year, listing.make, listing.model].filter(Boolean).join(" ");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave({ spec: spec || null, km: toNum(km), price: toNum(price) });
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
        aria-labelledby="edit-dialog-title"
        className={`${panelClass} flex w-full max-w-md flex-col shadow-xl`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <div className="min-w-0">
            <h2 id="edit-dialog-title" className="font-semibold">
              Edit car details
            </h2>
            <p className="truncate text-sm text-neutral-500">{title || "This car"}</p>
          </div>
          <button type="button" className={ghostButtonClass} onClick={onCancel} aria-label="Close" disabled={busy}>
            <XIcon />
          </button>
        </div>

        <div className="grid gap-3 px-4 py-3">
          <label className={labelClass}>
            Spec
            <select
              ref={firstField}
              className={`${inputClass} mt-1 pr-8`}
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
            >
              <option value="">Auto{detected ? ` (ad says ${detected})` : " (not stated in ad)"}</option>
              {SPEC_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>
              Mileage (km)
              <input
                className={`${inputClass} mt-1`}
                type="number"
                min="0"
                inputMode="numeric"
                value={km}
                onChange={(e) => setKm(e.target.value)}
                placeholder="e.g. 80000"
              />
            </label>
            <label className={labelClass}>
              Price (AED)
              <input
                className={`${inputClass} mt-1`}
                type="number"
                min="0"
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="e.g. 42000"
              />
            </label>
          </div>
          <p className="text-xs text-neutral-400">
            Overrides the scraped values and feeds the score. Leave a field blank to use what the ad shows.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <button type="button" className={ghostButtonClass} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={primaryButtonClass} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
