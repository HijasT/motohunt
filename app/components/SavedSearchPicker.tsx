"use client";

import { useState, type FormEvent } from "react";
import type { SavedSearchRow } from "../../lib/supabase/types";
import type { SearchGroupWithMembers } from "../../lib/supabase/queries";
import { PlusIcon } from "./icons";
import { errorMessage, focusRing, inputClass, panelClass, secondaryButtonClass, useToast } from "./ui";

type Props = {
  savedSearches: SavedSearchRow[];
  groups: SearchGroupWithMembers[];
  selectedIds: Set<string>;
  onToggleSearch: (id: string) => void;
  onToggleGroup: (group: SearchGroupWithMembers) => void;
  onClearSelection: () => void;
  onCreateGroup: (name: string, savedSearchIds: string[]) => Promise<void>;
  onNewSearch: () => void;
  newSearchOpen: boolean;
};

function compact(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

function range(from: number | null, to: number | null, fmt: (n: number) => string = String): string | null {
  if (from != null && to != null) return `${fmt(from)}–${fmt(to)}`;
  if (from != null) return `${fmt(from)}+`;
  if (to != null) return `≤ ${fmt(to)}`;
  return null;
}

/** One-line human summary of a saved search's criteria, e.g. "Toyota Land Cruiser · 2018–2023 · ≤ AED 150k". */
export function describeSearch(s: SavedSearchRow, { omitName = false } = {}): string {
  const car = [s.make, s.model].filter(Boolean).join(" ");
  // Most searches are auto-named "Make Model"; don't repeat that right under the name.
  const parts = [omitName && car.toLowerCase() === s.name.toLowerCase() ? "" : car];
  parts.push(range(s.year_from, s.year_to) ?? "");
  const price = range(s.price_from, s.price_to, compact);
  if (price) parts.push(`AED ${price}`);
  const km = range(s.km_from, s.km_to, compact);
  if (km) parts.push(`${km} km`);
  return parts.filter(Boolean).join(" · ") || "Any car";
}

function chipClass(active: boolean): string {
  return `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${focusRing} ${
    active
      ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
      : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
  }`;
}

export function SavedSearchPicker({
  savedSearches,
  groups,
  selectedIds,
  onToggleSearch,
  onToggleGroup,
  onClearSelection,
  onCreateGroup,
  onNewSearch,
  newSearchOpen,
}: Props) {
  const { notify } = useToast();
  const [groupName, setGroupName] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreateGroup(e: FormEvent) {
    e.preventDefault();
    if (!groupName.trim()) return;
    setCreating(true);
    try {
      await onCreateGroup(groupName.trim(), [...selectedIds]);
      notify(`Group “${groupName.trim()}” saved`);
      setGroupName("");
    } catch (err) {
      notify(`Couldn't save group: ${errorMessage(err)}`, { tone: "error" });
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className={`${panelClass} p-4`} aria-label="Saved searches">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Saved searches</h2>
          <p className="text-xs text-neutral-500">
            {selectedIds.size === 0
              ? "Showing all listings — pick one or more to narrow"
              : `${selectedIds.size} selected`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={onClearSelection}
              className="text-sm font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              Clear
            </button>
          )}
          {!newSearchOpen && (
            <button onClick={onNewSearch} className={secondaryButtonClass}>
              <PlusIcon /> New search
            </button>
          )}
        </div>
      </div>

      {savedSearches.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">
          No saved searches yet. Create one and the scraper will start collecting matching listings on its next run.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {savedSearches.map((s) => {
            const active = selectedIds.has(s.id);
            return (
              <button
                key={s.id}
                className={chipClass(active)}
                onClick={() => onToggleSearch(s.id)}
                aria-pressed={active}
                title={describeSearch(s)}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      )}

      {groups.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Groups</span>
          {groups.map((g) => {
            const active = g.saved_search_ids.length > 0 && g.saved_search_ids.every((id) => selectedIds.has(id));
            return (
              <button
                key={g.id}
                className={chipClass(active)}
                onClick={() => onToggleGroup(g)}
                aria-pressed={active}
                disabled={g.saved_search_ids.length === 0}
                title={savedSearches
                  .filter((s) => g.saved_search_ids.includes(s.id))
                  .map((s) => s.name)
                  .join(", ")}
              >
                {g.name}
                <span className={active ? "opacity-70" : "text-neutral-400"}>{g.saved_search_ids.length}</span>
              </button>
            );
          })}
        </div>
      )}

      {selectedIds.size > 1 && (
        <form
          onSubmit={handleCreateGroup}
          className="mt-4 flex flex-col gap-2 border-t border-neutral-100 pt-3 sm:flex-row sm:items-center dark:border-neutral-800"
        >
          <span className="text-sm text-neutral-500">Save these {selectedIds.size} as a group:</span>
          <input
            className={`${inputClass} py-1.5 sm:max-w-xs`}
            placeholder="Group name"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
          <button type="submit" disabled={!groupName.trim() || creating} className={secondaryButtonClass}>
            {creating ? "Saving…" : "Save group"}
          </button>
        </form>
      )}
    </section>
  );
}
