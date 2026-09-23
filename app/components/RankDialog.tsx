"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { RankingRow } from "../../lib/supabase/types";
import type { ListingGroup } from "../../lib/listingInsights";
import { GENERAL_LIST, LIST_ORDER, listLimit } from "./RankTab";
import { XIcon } from "./icons";
import { formatNumber, ghostButtonClass, inputClass, panelClass, primaryButtonClass } from "./ui";

const NEW_LIST = "__new__";

type Props = {
  group: ListingGroup;
  /** Current (unexpired) ranks across all lists, sorted by rank. */
  rankings: RankingRow[];
  onCancel: () => void;
  /** position is 1-based; cars at and below it shift down by one. */
  onConfirm: (list: string, position: number) => Promise<void>;
};

const labelClass = "block text-xs font-medium text-neutral-600 dark:text-neutral-400";

/** Asks where a favorite goes: which list, and which position in it. */
export function RankDialog({ group, rankings, onCancel, onConfirm }: Props) {
  const car = group.primary;
  const carTitle = [car.year, car.make, car.model].filter(Boolean).join(" ");

  // The chat's lists first (even if currently empty), then any others that exist.
  const lists = useMemo(() => {
    const existing = [...new Set(rankings.map((r) => r.list))];
    return [...LIST_ORDER, ...existing.filter((l) => !LIST_ORDER.includes(l)).sort()];
  }, [rankings]);

  const [choice, setChoice] = useState(GENERAL_LIST);
  const [newList, setNewList] = useState("");
  const list = choice === NEW_LIST ? newList.trim() : choice;
  const items = useMemo(() => rankings.filter((r) => r.list === list), [rankings, list]);
  const limit = listLimit(list);
  // Can't insert below the cap: a full list's last slot is #limit, not #limit+1.
  const lastSlot = Math.min(items.length + 1, limit);

  // Default to the bottom of whichever list is picked.
  const [position, setPosition] = useState(lastSlot);
  useEffect(() => setPosition(lastSlot), [list, lastSlot]);

  const [busy, setBusy] = useState(false);
  const firstField = useRef<HTMLSelectElement>(null);
  useEffect(() => firstField.current?.focus(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!list) return;
    setBusy(true);
    try {
      await onConfirm(list, position);
    } finally {
      setBusy(false);
    }
  }

  // Preview: the list as it will look, with the new car in its slot - and, if the
  // list is full, the car(s) pushed past the limit shown as dropping out.
  const preview = [...items.map((r) => ({ key: r.id, title: r.title ?? r.link ?? "?", isNew: false }))];
  preview.splice(position - 1, 0, { key: "new", title: carTitle, isNew: true });
  const dropping = preview.slice(limit);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rank-dialog-title"
        className={`${panelClass} flex max-h-[90vh] w-full max-w-md flex-col shadow-xl`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <div className="min-w-0">
            <h2 id="rank-dialog-title" className="font-semibold">
              Rank this car
            </h2>
            <p className="truncate text-sm text-neutral-500">
              {carTitle}
              {car.price != null && ` · AED ${formatNumber(car.price)}`}
              {car.km != null && ` · ${formatNumber(car.km)} km`}
            </p>
          </div>
          <button type="button" className={ghostButtonClass} onClick={onCancel} aria-label="Close" disabled={busy}>
            <XIcon />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 px-4 py-3">
          <label className={labelClass}>
            List
            <select
              ref={firstField}
              className={`${inputClass} mt-1 pr-8`}
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
            >
              {lists.map((l) => (
                <option key={l} value={l}>
                  {l} ({rankings.filter((r) => r.list === l).length}/{listLimit(l)})
                </option>
              ))}
              <option value={NEW_LIST}>New list…</option>
            </select>
          </label>
          <label className={labelClass}>
            Position
            <select
              className={`${inputClass} mt-1 pr-8`}
              value={position}
              onChange={(e) => setPosition(Number(e.target.value))}
              disabled={!list}
            >
              {Array.from({ length: lastSlot }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  #{n}
                  {n === 1 ? " (top)" : n === lastSlot ? " (bottom)" : ""}
                </option>
              ))}
            </select>
          </label>
          {choice === NEW_LIST && (
            <label className={`${labelClass} col-span-2`}>
              New list name
              <input
                className={`${inputClass} mt-1`}
                value={newList}
                onChange={(e) => setNewList(e.target.value)}
                placeholder="e.g. Hybrids"
                autoFocus
              />
            </label>
          )}
        </div>

        {list && dropping.length > 0 && (
          <p className="mx-4 mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            {list} holds {limit}. <span className="font-semibold">{dropping.map((d) => d.title).join(", ")}</span>{" "}
            will drop out to Favorites → “Dropped from ranking”.
          </p>
        )}

        {list && (
          <ol className="mx-4 mb-3 min-h-0 flex-1 overflow-y-auto rounded-lg border border-neutral-100 text-sm dark:border-neutral-800">
            {preview.map((p, i) => (
              <li
                key={p.key}
                className={`flex gap-2 px-3 py-1.5 ${
                  p.isNew
                    ? "bg-orange-50 font-semibold text-orange-800 dark:bg-orange-950/40 dark:text-orange-300"
                    : i >= limit
                      ? "bg-neutral-50 text-neutral-400 line-through dark:bg-neutral-800/40"
                      : "text-neutral-600 dark:text-neutral-400"
                } ${i === limit ? "border-t border-dashed border-neutral-300 dark:border-neutral-700" : ""}`}
              >
                <span className="w-6 shrink-0 text-right tabular-nums">{i < limit ? `${i + 1}.` : "—"}</span>
                <span className="truncate">{p.title}</span>
                {p.isNew && <span className="ml-auto shrink-0 text-xs font-medium">new</span>}
                {i >= limit && <span className="ml-auto shrink-0 text-xs font-medium no-underline">drops out</span>}
              </li>
            ))}
          </ol>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <button type="button" className={ghostButtonClass} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={primaryButtonClass} disabled={!list || busy}>
            {busy ? "Ranking…" : `Rank #${position}${list ? ` in ${list}` : ""}`}
          </button>
        </div>
      </form>
    </div>
  );
}
