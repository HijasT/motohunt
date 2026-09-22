"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ListingRow, SavedSearchRow, ScrapeStatus } from "../../lib/supabase/types";
import {
  clearListingStatus,
  fetchDisliked,
  type SavedSearchInput,
  type SearchGroupWithMembers,
} from "../../lib/supabase/queries";
import { groupDuplicates, type ListingGroup } from "../../lib/listingInsights";
import { FilterBar } from "./FilterBar";
import { describeSearch } from "./SavedSearchPicker";
import { ScrapeHealth } from "./ScrapeHealth";
import { ExternalIcon, PencilIcon, TrashIcon, UndoIcon } from "./icons";
import { ErrorNote, errorMessage, formatNumber, ghostButtonClass, panelClass, useToast } from "./ui";

type Props = {
  savedSearches: SavedSearchRow[];
  groups: SearchGroupWithMembers[];
  scrape: ScrapeStatus | null;
  onUpdateSearch: (id: string, input: SavedSearchInput) => Promise<void>;
  onDeleteSearch: (id: string) => Promise<void>;
  onDeleteGroup: (id: string) => Promise<void>;
};

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className={`${panelClass} overflow-hidden`}>
      <header className="border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-neutral-500">{hint}</p>
      </header>
      {children}
    </section>
  );
}

const rowClass = "flex items-center gap-3 px-4 py-3";
const listClass = "divide-y divide-neutral-100 dark:divide-neutral-800";
const emptyRowClass = "px-4 py-6 text-sm text-neutral-500";

/**
 * Deletes are two-step (click, then confirm within the same row) since saved
 * searches and groups have no undo - the scraper stops tracking immediately.
 */
function DeleteButton({ label, onConfirm }: { label: string; onConfirm: () => Promise<void> }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  if (!armed) {
    return (
      <button className={`${ghostButtonClass} hover:!text-red-600`} onClick={() => setArmed(true)} aria-label={`Delete ${label}`}>
        <TrashIcon />
      </button>
    );
  }
  return (
    <button
      className={`${ghostButtonClass} bg-red-50 !text-red-700 hover:!bg-red-100 dark:bg-red-950/50 dark:!text-red-300`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          setBusy(false);
          setArmed(false);
        }
      }}
    >
      {busy ? "Deleting…" : "Confirm delete"}
    </button>
  );
}

export function SettingsTab({ savedSearches, groups, scrape, onUpdateSearch, onDeleteSearch, onDeleteGroup }: Props) {
  const { notify } = useToast();
  const [disliked, setDisliked] = useState<ListingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDisliked()
      .then((rows) => !cancelled && setDisliked(rows))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUnhide(group: ListingGroup) {
    const keys = new Set(group.keys);
    setDisliked((prev) => prev?.filter((l) => !keys.has(l.unique_key)) ?? prev);
    try {
      await clearListingStatus(group.keys);
      notify("Listing restored to Results");
    } catch (e) {
      setDisliked((prev) => (prev ? [group.primary, ...group.others, ...prev] : prev));
      notify(`Couldn't restore: ${errorMessage(e)}`, { tone: "error" });
    }
  }

  const hiddenGroups = groupDuplicates(disliked ?? []);

  const withErrorToast = (fn: () => Promise<void>, what: string) => async () => {
    try {
      await fn();
      notify(`${what} deleted`);
    } catch (e) {
      notify(`Couldn't delete: ${errorMessage(e)}`, { tone: "error" });
    }
  };

  const searchName = new Map(savedSearches.map((s) => [s.id, s.name]));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <Section title="Scraper" hint="What the last scheduled run found on each site.">
          <ScrapeHealth scrape={scrape} />
        </Section>
      </div>

      {/* Widen to full width while editing so the form's range inputs have room. */}
      <div className={editingId ? "lg:col-span-2" : ""}>
      <Section title="Saved searches" hint="Each one is scraped from every site on the 6-hourly run.">
        {savedSearches.length === 0 ? (
          <p className={emptyRowClass}>None yet.</p>
        ) : (
          <ul className={listClass}>
            {savedSearches.map((s) =>
              editingId === s.id ? (
                <li key={s.id} className="bg-neutral-50 p-3 dark:bg-neutral-950/40">
                  <FilterBar
                    initial={s}
                    onClose={() => setEditingId(null)}
                    onSave={async (input) => {
                      await onUpdateSearch(s.id, input);
                      notify(`Updated “${input.name}”`);
                    }}
                  />
                </li>
              ) : (
              <li key={s.id} className={rowClass}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.name}</p>
                  <p className="truncate text-sm text-neutral-500">{describeSearch(s, { omitName: true })}</p>
                </div>
                <button className={ghostButtonClass} onClick={() => setEditingId(s.id)} aria-label={`Edit ${s.name}`}>
                  <PencilIcon />
                </button>
                <DeleteButton label={s.name} onConfirm={withErrorToast(() => onDeleteSearch(s.id), `“${s.name}”`)} />
              </li>
              )
            )}
          </ul>
        )}
      </Section>
      </div>

      <Section title="Groups" hint="Select several saved searches on Results to save them as a group.">
        {groups.length === 0 ? (
          <p className={emptyRowClass}>None yet.</p>
        ) : (
          <ul className={listClass}>
            {groups.map((g) => (
              <li key={g.id} className={rowClass}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{g.name}</p>
                  <p className="truncate text-sm text-neutral-500">
                    {g.saved_search_ids.map((id) => searchName.get(id)).filter(Boolean).join(", ") || "No searches"}
                  </p>
                </div>
                <DeleteButton label={g.name} onConfirm={withErrorToast(() => onDeleteGroup(g.id), `Group “${g.name}”`)} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="lg:col-span-2">
        <Section title="Hidden listings" hint="Listings you hid from Results. Restore one to see it there again.">
          {error ? (
            <div className="p-4">
              <ErrorNote>{error}</ErrorNote>
            </div>
          ) : disliked === null ? (
            <p className={emptyRowClass}>Loading…</p>
          ) : hiddenGroups.length === 0 ? (
            <p className={emptyRowClass}>Nothing hidden.</p>
          ) : (
            <ul className={listClass}>
              {hiddenGroups.map((g) => {
                const l = g.primary;
                return (
                <li key={l.unique_key} className={rowClass}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {l.year ?? ""} {l.make} {l.model}
                    </p>
                    <p className="truncate text-sm tabular-nums text-neutral-500">
                      {[...new Set([l, ...g.others].map((x) => x.source))].join(" + ")} · AED {formatNumber(l.price)} ·{" "}
                      {formatNumber(l.km)} km
                    </p>
                  </div>
                  <a href={l.link} target="_blank" rel="noreferrer" className={ghostButtonClass} aria-label="View ad">
                    <ExternalIcon />
                  </a>
                  <button className={ghostButtonClass} onClick={() => handleUnhide(g)}>
                    <UndoIcon /> Restore
                  </button>
                </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
