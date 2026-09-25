"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { BlockedModelRow, ListingRow, SavedSearchRow, ScrapeStatus } from "../../lib/supabase/types";
import {
  clearListingStatus,
  fetchDisliked,
  type SavedSearchInput,
  type SearchGroupWithMembers,
} from "../../lib/supabase/queries";
import { carKey, groupDuplicates, type ListingGroup } from "../../lib/listingInsights";
import { FilterBar } from "./FilterBar";
import { describeSearch } from "./SavedSearchPicker";
import { ScrapeHealth } from "./ScrapeHealth";
import { ChevronIcon, ExternalIcon, PencilIcon, SearchIcon, TrashIcon, UndoIcon, XIcon } from "./icons";
import {
  ErrorNote,
  errorMessage,
  formatNumber,
  ghostButtonClass,
  inputClass,
  panelClass,
  secondaryButtonClass,
  usePersistentState,
  useToast,
} from "./ui";

type Props = {
  savedSearches: SavedSearchRow[];
  groups: SearchGroupWithMembers[];
  scrape: ScrapeStatus | null;
  onUpdateSearch: (id: string, input: SavedSearchInput) => Promise<void>;
  onDeleteSearch: (id: string) => Promise<void>;
  onDeleteGroup: (id: string) => Promise<void>;
  blocked: BlockedModelRow[];
  onBlock: (make: string, model: string | null) => Promise<void>;
  onUnblock: (row: BlockedModelRow) => Promise<void>;
  /** A hidden car was restored - it goes to Results' "Just restored" strip. */
  onRestored: (group: ListingGroup) => void;
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

export function SettingsTab({
  savedSearches,
  groups,
  scrape,
  onUpdateSearch,
  onDeleteSearch,
  onDeleteGroup,
  blocked,
  onBlock,
  onUnblock,
  onRestored,
}: Props) {
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
      // The page puts it in Results' "Just restored" strip and offers to jump there.
      onRestored(group);
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
      <Section title="Saved searches" hint="Each one is scraped from every site on the 3-hourly run.">
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
        <BlockedModels blocked={blocked} onBlock={onBlock} onUnblock={onUnblock} />
      </div>

      <div className="lg:col-span-2">
        <HiddenListings groups={hiddenGroups} loading={disliked === null} error={error} onRestore={handleUnhide} />
      </div>
    </div>
  );
}

function BlockForm({ onBlock }: { onBlock: (make: string, model: string | null) => Promise<void> }) {
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!make.trim()) return;
    setBusy(true);
    try {
      await onBlock(make.trim(), model.trim() || null);
      setMake("");
      setModel("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-b border-neutral-100 px-4 py-3 sm:flex-row dark:border-neutral-800">
      <input className={`${inputClass} py-1.5`} placeholder="Make, e.g. Renault" value={make} onChange={(e) => setMake(e.target.value)} aria-label="Make to block" />
      <input
        className={`${inputClass} py-1.5`}
        placeholder="Model, e.g. Symbol (empty = every model)"
        value={model}
        onChange={(e) => setModel(e.target.value)}
        aria-label="Model to block"
      />
      <button type="submit" disabled={!make.trim() || busy} className={`${secondaryButtonClass} shrink-0`}>
        Block
      </button>
    </form>
  );
}

/** Of two spellings of one name, prefer "Kia" over "KIA" (sites differ in capitalisation). */
function nicerName(current: string, candidate: string): string {
  const shouting = (m: string) => m === m.toUpperCase() && m !== m.toLowerCase();
  return shouting(current) && !shouting(candidate) ? candidate : current;
}

/** Case/spacing-insensitive make key, so "Renault" and "RENAULT" land in one group. */
const makeKey = (make: string) => make.trim().toLowerCase();

/**
 * Blocked models, grouped by make (A-Z) with models A-Z inside - a whole-make
 * block ("All models") first. Collapsible, collapsed by default; remembered.
 */
function BlockedModels({
  blocked,
  onBlock,
  onUnblock,
}: {
  blocked: BlockedModelRow[];
  onBlock: (make: string, model: string | null) => Promise<void>;
  onUnblock: (row: BlockedModelRow) => Promise<void>;
}) {
  const [open, setOpen] = usePersistentState("motohunt.blockedOpen", false);

  const byMake = useMemo(() => {
    const groups = new Map<string, { make: string; rows: BlockedModelRow[] }>();
    for (const b of blocked) {
      const key = makeKey(b.make);
      const g = groups.get(key) ?? { make: b.make.trim(), rows: [] };
      g.make = nicerName(g.make, b.make.trim());
      g.rows.push(b);
      groups.set(key, g);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, g]) => ({
        ...g,
        rows: g.rows.sort((a, b) =>
          a.model == null ? -1 : b.model == null ? 1 : a.model.localeCompare(b.model, undefined, { sensitivity: "base" })
        ),
      }));
  }, [blocked]);

  return (
    <section className={`${panelClass} overflow-hidden`}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
      >
        <ChevronIcon className={`mt-1 h-4 w-4 shrink-0 text-neutral-400 transition-transform ${open ? "rotate-90" : ""}`} />
        <div className="min-w-0 flex-1">
          <h2 className="flex items-baseline gap-2 font-semibold">
            Blocked models
            <span className="text-sm font-medium tabular-nums text-neutral-400">
              {blocked.length}
              {byMake.length > 0 && ` · ${byMake.length} make${byMake.length === 1 ? "" : "s"}`}
            </span>
          </h2>
          <p className="text-sm text-neutral-500">
            Never shown in search results, from any saved search. Favorites and ranked cars aren&apos;t affected.
          </p>
        </div>
      </button>

      {open && (
        <div className="border-t border-neutral-100 dark:border-neutral-800">
          <BlockForm onBlock={onBlock} />
          {byMake.length === 0 ? (
            <p className={emptyRowClass}>
              Nothing blocked. Use the ⊘ button on a result to block its model, or add one above.
            </p>
          ) : (
            <div className={listClass}>
              {byMake.map((g) => (
                <div key={g.make} className="px-4 py-3">
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                    {g.make} <span className="font-medium text-neutral-400">{g.rows.length}</span>
                  </h3>
                  <ul className="flex flex-wrap gap-2">
                    {g.rows.map((b) => (
                      <li
                        key={b.id}
                        className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 py-0.5 pl-3 pr-1 text-sm dark:border-neutral-700 dark:bg-neutral-800/60"
                        title={`Blocked ${new Date(b.created_at).toLocaleDateString()}`}
                      >
                        {b.model ?? <span className="italic text-neutral-500">All models</span>}
                        <button
                          className="rounded-full p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-900 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
                          onClick={() => onUnblock(b)}
                          aria-label={`Unblock ${g.make} ${b.model ?? "(all models)"}`}
                          title="Unblock - show in results again"
                        >
                          <XIcon className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

type HiddenModel = { key: string; model: string; cars: ListingGroup[] };
type HiddenMake = { key: string; make: string; count: number; models: HiddenModel[] };

/**
 * Hidden listings grouped make (A-Z) -> model (A-Z) -> cars (newest year, then
 * cheapest). Each model is a collapsible row with its count; the search box
 * filters by make/model/year/source and opens every model that still matches.
 * The whole section collapses too (remembered).
 */
function HiddenListings({
  groups,
  loading,
  error,
  onRestore,
}: {
  groups: ListingGroup[];
  loading: boolean;
  error: string | null;
  onRestore: (g: ListingGroup) => void;
}) {
  const [open, setOpen] = usePersistentState("motohunt.hiddenOpen", false);
  const [query, setQuery] = useState("");

  const makes = useMemo<HiddenMake[]>(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (g: ListingGroup) => {
      if (words.length === 0) return true;
      const text = [g.primary, ...g.others]
        .map((l) => `${l.year ?? ""} ${l.make} ${l.model} ${l.source}`)
        .join(" ")
        .toLowerCase();
      return words.every((w) => text.includes(w));
    };

    const byMake = new Map<string, { make: string; models: Map<string, HiddenModel> }>();
    for (const g of groups.filter(matches)) {
      const l = g.primary;
      const key = carKey(l); // "nissan|xtrail" - ignores case and punctuation
      const mKey = key.split("|")[0];
      const make = byMake.get(mKey) ?? { make: l.make.trim(), models: new Map<string, HiddenModel>() };
      make.make = nicerName(make.make, l.make.trim());
      const model = make.models.get(key) ?? { key, model: l.model.trim(), cars: [] };
      model.model = nicerName(model.model, l.model.trim());
      model.cars.push(g);
      make.models.set(key, model);
      byMake.set(mKey, make);
    }

    return [...byMake.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, m]) => {
        const models = [...m.models.values()]
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((mo) => ({
            ...mo,
            cars: mo.cars.sort(
              (a, b) => (b.primary.year ?? 0) - (a.primary.year ?? 0) || (a.primary.price ?? Infinity) - (b.primary.price ?? Infinity)
            ),
          }));
        return { key, make: m.make, count: models.reduce((n, mo) => n + mo.cars.length, 0), models };
      });
  }, [groups, query]);

  const searching = query.trim() !== "";
  const shown = makes.reduce((n, m) => n + m.count, 0);

  return (
    <section className={`${panelClass} overflow-hidden`}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
      >
        <ChevronIcon className={`mt-1 h-4 w-4 shrink-0 text-neutral-400 transition-transform ${open ? "rotate-90" : ""}`} />
        <div className="min-w-0 flex-1">
          <h2 className="flex items-baseline gap-2 font-semibold">
            Hidden listings
            {!loading && (
              <span className="text-sm font-medium tabular-nums text-neutral-400">
                {groups.length} · {new Set(groups.map((g) => carKey(g.primary))).size} models
              </span>
            )}
          </h2>
          <p className="text-sm text-neutral-500">Listings you hid or removed. Restore one to see it in Results again.</p>
        </div>
      </button>

      {open && (
        <div className="border-t border-neutral-100 dark:border-neutral-800">
          {error ? (
            <div className="p-4">
              <ErrorNote>{error}</ErrorNote>
            </div>
          ) : loading ? (
            <p className={emptyRowClass}>Loading…</p>
          ) : groups.length === 0 ? (
            <p className={emptyRowClass}>Nothing hidden.</p>
          ) : (
            <>
              <div className="border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-neutral-400">
                    <SearchIcon />
                  </span>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search hidden cars — e.g. “x-trail 2021” or “dubizzle”"
                    aria-label="Search hidden cars"
                    className={`${inputClass} py-1.5 pl-9`}
                  />
                </div>
                {searching && (
                  <p className="mt-1.5 text-xs text-neutral-500">
                    {shown} of {groups.length} match
                  </p>
                )}
              </div>
              {makes.length === 0 ? (
                <p className={emptyRowClass}>No hidden cars match “{query}”.</p>
              ) : (
                <div className={listClass}>
                  {makes.map((m) => (
                    <div key={m.key} className="px-4 py-3">
                      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                        {m.make} <span className="font-medium text-neutral-400">{m.count}</span>
                      </h3>
                      <div className="space-y-1.5">
                        {m.models.map((mo) => (
                          // Remount on search so matching models open, and close again when cleared.
                          <details
                            key={`${mo.key}-${searching}`}
                            open={searching}
                            className="group rounded-lg border border-neutral-100 dark:border-neutral-800"
                          >
                            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800/40 [&::-webkit-details-marker]:hidden">
                              <ChevronIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform group-open:rotate-90" />
                              {mo.model}
                              <span className="font-normal tabular-nums text-neutral-400">{mo.cars.length}</span>
                            </summary>
                            <ul className="divide-y divide-neutral-100 border-t border-neutral-100 dark:divide-neutral-800 dark:border-neutral-800">
                              {mo.cars.map((g) => {
                                const l = g.primary;
                                return (
                                  <li key={l.unique_key} className="flex items-center gap-3 px-3 py-2">
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-medium tabular-nums">
                                        {l.year ?? "—"} · AED {formatNumber(l.price)} · {formatNumber(l.km)} km
                                      </p>
                                      <p className="truncate text-xs text-neutral-500">
                                        {[...new Set([l, ...g.others].map((x) => x.source))].join(" + ")}
                                        {l.description ? ` · ${l.description}` : ""}
                                      </p>
                                    </div>
                                    <a href={l.link} target="_blank" rel="noreferrer" className={ghostButtonClass} aria-label="View ad">
                                      <ExternalIcon />
                                    </a>
                                    <button className={ghostButtonClass} onClick={() => onRestore(g)}>
                                      <UndoIcon /> Restore
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          </details>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
