"use client";

import { useState } from "react";
import type { SavedSearchRow } from "../../lib/supabase/types";
import type { SearchGroupWithMembers } from "../../lib/supabase/queries";

type Props = {
  savedSearches: SavedSearchRow[];
  groups: SearchGroupWithMembers[];
  selectedIds: Set<string>;
  onToggleSearch: (id: string) => void;
  onToggleGroup: (group: SearchGroupWithMembers) => void;
  onDeleteSearch: (id: string) => void;
  onCreateGroup: (name: string, savedSearchIds: string[]) => Promise<void>;
  onDeleteGroup: (id: string) => void;
};

function describe(s: SavedSearchRow): string {
  const parts = [s.make, s.model].filter(Boolean);
  if (s.price_to) parts.push(`≤ AED ${s.price_to.toLocaleString()}`);
  return parts.length > 0 ? parts.join(" · ") : s.name;
}

function chipClass(active: boolean): string {
  return `rounded-full border px-3 py-1 text-sm transition ${
    active
      ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
      : "border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
  }`;
}

const removeChipClass =
  "absolute -right-1.5 -top-1.5 hidden h-4 w-4 rounded-full bg-neutral-700 text-[10px] leading-4 text-white group-hover:block";

export function SavedSearchPicker({
  savedSearches,
  groups,
  selectedIds,
  onToggleSearch,
  onToggleGroup,
  onDeleteSearch,
  onCreateGroup,
  onDeleteGroup,
}: Props) {
  const [groupName, setGroupName] = useState("");

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="text-sm font-semibold text-neutral-500">
        Filters {selectedIds.size === 0 && <span className="font-normal">(showing everything)</span>}
      </h2>

      {savedSearches.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">No saved searches yet — create one above.</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {savedSearches.map((s) => (
            <div key={s.id} className="group relative">
              <button className={chipClass(selectedIds.has(s.id))} onClick={() => onToggleSearch(s.id)} title={describe(s)}>
                {s.name}
              </button>
              <button onClick={() => onDeleteSearch(s.id)} className={removeChipClass} title="Delete saved search">
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {groups.length > 0 && (
        <>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-400">Groups</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {groups.map((g) => {
              const active = g.saved_search_ids.length > 0 && g.saved_search_ids.every((id) => selectedIds.has(id));
              return (
                <div key={g.id} className="group relative">
                  <button className={chipClass(active)} onClick={() => onToggleGroup(g)}>
                    {g.name} ({g.saved_search_ids.length})
                  </button>
                  <button onClick={() => onDeleteGroup(g.id)} className={removeChipClass} title="Delete group">
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {savedSearches.length > 1 && (
        <div className="mt-4 flex items-center gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <input
            className="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            placeholder="Group name for the selected searches"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
          <button
            disabled={!groupName.trim() || selectedIds.size === 0}
            onClick={async () => {
              await onCreateGroup(groupName.trim(), [...selectedIds]);
              setGroupName("");
            }}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
          >
            Save as group
          </button>
        </div>
      )}
    </div>
  );
}
