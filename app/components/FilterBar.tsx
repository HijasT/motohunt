"use client";

import { useState, type FormEvent } from "react";
import type { SavedSearchInput } from "../../lib/supabase/queries";
import type { SavedSearchRow } from "../../lib/supabase/types";
import { XIcon } from "./icons";
import { errorMessage, ghostButtonClass, inputClass, panelClass, primaryButtonClass } from "./ui";

type Props = {
  onSave: (input: SavedSearchInput) => Promise<void>;
  onClose: () => void;
  /** Present when editing an existing saved search; the form starts filled in. */
  initial?: SavedSearchRow;
};

const EMPTY = {
  name: "",
  make: "",
  model: "",
  yearFrom: "",
  yearTo: "",
  priceFrom: "",
  priceTo: "",
  kmFrom: "",
  kmTo: "",
};

type Fields = typeof EMPTY;

const str = (n: number | null) => (n === null ? "" : n.toLocaleString("en-US"));

function fieldsFrom(row: SavedSearchRow | undefined): Fields {
  if (!row) return EMPTY;
  return {
    name: row.name,
    make: row.make ?? "",
    model: row.model ?? "",
    yearFrom: row.year_from === null ? "" : String(row.year_from),
    yearTo: row.year_to === null ? "" : String(row.year_to),
    priceFrom: str(row.price_from),
    priceTo: str(row.price_to),
    kmFrom: str(row.km_from),
    kmTo: str(row.km_to),
  };
}

const labelClass = "block text-xs font-medium text-neutral-600 dark:text-neutral-400";

/** Accepts "150,000" / "150 000" as well as "150000". */
function parseNum(s: string): number | null | "invalid" {
  const cleaned = s.replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : "invalid";
}

export function FilterBar({ onSave, onClose, initial }: Props) {
  const [fields, setFields] = useState<Fields>(() => fieldsFrom(initial));
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const set = (key: keyof Fields) => (e: { target: { value: string } }) =>
    setFields((prev) => ({ ...prev, [key]: e.target.value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    const make = fields.make.trim();
    const model = fields.model.trim();
    if (!make && !model && !fields.priceTo.trim()) {
      setErrorMsg("Set at least a make, a model, or a max price.");
      return;
    }

    const ranges = [
      ["Year", fields.yearFrom, fields.yearTo],
      ["Price", fields.priceFrom, fields.priceTo],
      ["Mileage", fields.kmFrom, fields.kmTo],
    ] as const;
    const parsed: Record<string, [number | null, number | null]> = {};
    for (const [label, fromRaw, toRaw] of ranges) {
      const from = parseNum(fromRaw);
      const to = parseNum(toRaw);
      if (from === "invalid" || to === "invalid") {
        setErrorMsg(`${label} must be a number.`);
        return;
      }
      if (from !== null && to !== null && from > to) {
        setErrorMsg(`${label}: the minimum is higher than the maximum.`);
        return;
      }
      parsed[label] = [from, to];
    }

    setSaving(true);
    try {
      await onSave({
        name: fields.name.trim() || [make, model].filter(Boolean).join(" ") || "Untitled search",
        make: make || null,
        model: model || null,
        year_from: parsed.Year[0],
        year_to: parsed.Year[1],
        price_from: parsed.Price[0],
        price_to: parsed.Price[1],
        km_from: parsed.Mileage[0],
        km_to: parsed.Mileage[1],
      });
      setFields(EMPTY);
      onClose();
    } catch (err) {
      setErrorMsg(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={`${panelClass} p-4 sm:p-5`}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">{initial ? `Edit “${initial.name}”` : "New saved search"}</h2>
          <p className="text-sm text-neutral-500">
            {initial
              ? "Results update right away; the scraper picks up the new criteria on its next run."
              : "The scraper checks every site for these criteria on its next run."}
          </p>
        </div>
        <button type="button" onClick={onClose} className={ghostButtonClass} aria-label="Close">
          <XIcon />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
        <label className={labelClass}>
          Make
          <input className={`${inputClass} mt-1`} value={fields.make} onChange={set("make")} placeholder="Toyota" autoFocus />
        </label>
        <label className={labelClass}>
          Model
          <input className={`${inputClass} mt-1`} value={fields.model} onChange={set("model")} placeholder="Land Cruiser" />
        </label>
        <label className={`${labelClass} col-span-2`}>
          Name <span className="font-normal text-neutral-400">(optional)</span>
          <input
            className={`${inputClass} mt-1`}
            value={fields.name}
            onChange={set("name")}
            placeholder={[fields.make, fields.model].filter(Boolean).join(" ") || "e.g. Family SUV under 150k"}
          />
        </label>

        <RangeField label="Year" from={fields.yearFrom} to={fields.yearTo} onFrom={set("yearFrom")} onTo={set("yearTo")} fromPh="2018" toPh="2024" />
        <RangeField label="Price (AED)" from={fields.priceFrom} to={fields.priceTo} onFrom={set("priceFrom")} onTo={set("priceTo")} fromPh="Min" toPh="150,000" />
        <RangeField label="Mileage (km)" from={fields.kmFrom} to={fields.kmTo} onFrom={set("kmFrom")} onTo={set("kmTo")} fromPh="Min" toPh="100,000" />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className={primaryButtonClass}>
          {saving ? "Saving…" : initial ? "Save changes" : "Save search"}
        </button>
        <button type="button" onClick={onClose} className={ghostButtonClass}>
          Cancel
        </button>
        {errorMsg && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {errorMsg}
          </p>
        )}
      </div>
    </form>
  );
}

type RangeProps = {
  label: string;
  from: string;
  to: string;
  onFrom: (e: { target: { value: string } }) => void;
  onTo: (e: { target: { value: string } }) => void;
  fromPh: string;
  toPh: string;
};

function RangeField({ label, from, to, onFrom, onTo, fromPh, toPh }: RangeProps) {
  return (
    <fieldset className="col-span-2 sm:col-span-2 lg:col-span-1">
      <legend className={labelClass}>{label}</legend>
      <div className="mt-1 flex items-center gap-2">
        <input className={inputClass} value={from} onChange={onFrom} inputMode="numeric" placeholder={fromPh} aria-label={`${label} from`} />
        <span className="text-neutral-400">–</span>
        <input className={inputClass} value={to} onChange={onTo} inputMode="numeric" placeholder={toPh} aria-label={`${label} to`} />
      </div>
    </fieldset>
  );
}
