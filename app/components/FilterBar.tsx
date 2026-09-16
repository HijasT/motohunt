"use client";

import { useState } from "react";
import type { SavedSearchInput } from "../../lib/supabase/queries";

type Props = {
  onSave: (input: SavedSearchInput) => Promise<void>;
};

const inputClass =
  "w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900";

export function FilterBar({ onSave }: Props) {
  const [name, setName] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [priceFrom, setPriceFrom] = useState("");
  const [priceTo, setPriceTo] = useState("");
  const [kmFrom, setKmFrom] = useState("");
  const [kmTo, setKmTo] = useState("");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const toNum = (s: string): number | null => (s.trim() === "" ? null : Number(s));

  async function handleSave() {
    setErrorMsg(null);
    if (!make.trim() && !model.trim() && !priceTo.trim()) {
      setErrorMsg("Set at least one of make, model, or max price.");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        name: name.trim() || [make, model].filter(Boolean).join(" ") || "Untitled search",
        make: make.trim() || null,
        model: model.trim() || null,
        price_from: toNum(priceFrom),
        price_to: toNum(priceTo),
        km_from: toNum(kmFrom),
        km_to: toNum(kmTo),
        year_from: toNum(yearFrom),
        year_to: toNum(yearTo),
      });
      setName("");
      setMake("");
      setModel("");
      setPriceFrom("");
      setPriceTo("");
      setKmFrom("");
      setKmTo("");
      setYearFrom("");
      setYearTo("");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-3 text-sm font-semibold text-neutral-500">New saved search</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="col-span-2 text-xs text-neutral-500 sm:col-span-4">
          Name (optional)
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Land Cruiser under 150k"
          />
        </label>
        <label className="text-xs text-neutral-500">
          Make
          <input className={inputClass} value={make} onChange={(e) => setMake(e.target.value)} placeholder="Toyota" />
        </label>
        <label className="text-xs text-neutral-500">
          Model
          <input
            className={inputClass}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Land Cruiser"
          />
        </label>
        <label className="text-xs text-neutral-500">
          Year from
          <input
            className={inputClass}
            value={yearFrom}
            onChange={(e) => setYearFrom(e.target.value)}
            inputMode="numeric"
            placeholder="2018"
          />
        </label>
        <label className="text-xs text-neutral-500">
          Year to
          <input
            className={inputClass}
            value={yearTo}
            onChange={(e) => setYearTo(e.target.value)}
            inputMode="numeric"
            placeholder="2023"
          />
        </label>
        <label className="text-xs text-neutral-500">
          Min price (AED)
          <input
            className={inputClass}
            value={priceFrom}
            onChange={(e) => setPriceFrom(e.target.value)}
            inputMode="numeric"
          />
        </label>
        <label className="text-xs text-neutral-500">
          Max price (AED)
          <input
            className={inputClass}
            value={priceTo}
            onChange={(e) => setPriceTo(e.target.value)}
            inputMode="numeric"
            placeholder="150000"
          />
        </label>
        <label className="text-xs text-neutral-500">
          Min km
          <input
            className={inputClass}
            value={kmFrom}
            onChange={(e) => setKmFrom(e.target.value)}
            inputMode="numeric"
          />
        </label>
        <label className="text-xs text-neutral-500">
          Max km
          <input
            className={inputClass}
            value={kmTo}
            onChange={(e) => setKmTo(e.target.value)}
            inputMode="numeric"
            placeholder="100000"
          />
        </label>
      </div>

      {errorMsg && <p className="mt-2 text-sm text-red-600">{errorMsg}</p>}

      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-3 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {saving ? "Saving…" : "Save search"}
      </button>
    </div>
  );
}
