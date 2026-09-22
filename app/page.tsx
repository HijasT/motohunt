"use client";

import { useEffect, useMemo, useState } from "react";
import { FilterBar } from "./components/FilterBar";
import { SavedSearchPicker } from "./components/SavedSearchPicker";
import { ResultsTab } from "./components/ResultsTab";
import { FavoritesTab } from "./components/FavoritesTab";
import { SettingsTab } from "./components/SettingsTab";
import { ScrapeStatusPill } from "./components/ScrapeHealth";
import { CarIcon } from "./components/icons";
import { CardGridSkeleton, ErrorNote, ToastProvider, errorMessage, focusRing, usePersistentState, useToast } from "./components/ui";
import type { ListingRow, SavedSearchRow, ScrapeStatus } from "../lib/supabase/types";
import { computeDeals } from "../lib/listingInsights";
import {
  createSavedSearch,
  createSearchGroup,
  deleteSavedSearch,
  deleteSearchGroup,
  fetchMarketListings,
  fetchSavedSearches,
  fetchSearchGroups,
  getLastVisit,
  getScrapeStatus,
  markVisitedNow,
  updateSavedSearch,
  type SavedSearchInput,
  type SearchGroupWithMembers,
} from "../lib/supabase/queries";

type Tab = "results" | "favorites" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "results", label: "Results" },
  { id: "favorites", label: "Favorites" },
  { id: "settings", label: "Settings" },
];

function tabClass(active: boolean): string {
  return `relative rounded-lg px-2.5 py-1.5 sm:px-3 text-sm font-medium transition ${focusRing} ${
    active
      ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
      : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
  }`;
}

export default function Home() {
  return (
    <ToastProvider>
      <App />
    </ToastProvider>
  );
}

function App() {
  const { notify } = useToast();
  const [tab, setTab] = usePersistentState<Tab>("motohunt.tab", "results");
  const [savedSearches, setSavedSearches] = useState<SavedSearchRow[]>([]);
  const [groups, setGroups] = useState<SearchGroupWithMembers[]>([]);
  const [selected, setSelected] = usePersistentState<string[]>("motohunt.selected", []);
  const [lastVisit, setLastVisit] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showNewSearch, setShowNewSearch] = useState(false);
  const [scrape, setScrape] = useState<ScrapeStatus | null>(null);
  const [market, setMarket] = useState<ListingRow[]>([]);

  async function refresh() {
    const [searches, gs] = await Promise.all([fetchSavedSearches(), fetchSearchGroups()]);
    setSavedSearches(searches);
    setGroups(gs);
  }

  useEffect(() => {
    // Nice-to-haves: the header status and deal scores. Neither blocks the page, and
    // failures just mean those badges don't show (e.g. before the migration runs).
    getScrapeStatus().then(setScrape).catch(() => {});
    fetchMarketListings().then(setMarket).catch(() => {});

    (async () => {
      try {
        // "New" means new since the previous page load. Read it once here and bump it
        // once, so switching tabs or toggling filters doesn't wipe the badges mid-session.
        const [previousVisit] = await Promise.all([getLastVisit(), refresh()]);
        setLastVisit(previousVisit);
        setLoaded(true);
        markVisitedNow().catch(() => {
          /* non-critical: worst case the same listings show as new next time */
        });
      } catch (e) {
        setLoadError(errorMessage(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deals = useMemo(() => computeDeals(market), [market]);

  // Ignore remembered selections whose saved search has since been deleted.
  const selectedIds = useMemo(() => {
    const existing = new Set(savedSearches.map((s) => s.id));
    return new Set(selected.filter((id) => !loaded || existing.has(id)));
  }, [selected, savedSearches, loaded]);

  const selectedSearches = useMemo(
    () => savedSearches.filter((s) => selectedIds.has(s.id)),
    [savedSearches, selectedIds]
  );

  async function handleSaveSearch(input: SavedSearchInput) {
    const created = await createSavedSearch(input);
    await refresh();
    notify(`Saved “${created.name}” — listings will appear after the next scrape`);
  }

  async function handleUpdateSearch(id: string, input: SavedSearchInput) {
    await updateSavedSearch(id, input);
    await refresh();
  }

  async function handleDeleteSearch(id: string) {
    await deleteSavedSearch(id);
    setSelected(selected.filter((s) => s !== id));
    await refresh();
  }

  function toggleSearch(id: string) {
    setSelected(selectedIds.has(id) ? [...selectedIds].filter((s) => s !== id) : [...selectedIds, id]);
  }

  function toggleGroup(group: SearchGroupWithMembers) {
    const allSelected = group.saved_search_ids.length > 0 && group.saved_search_ids.every((id) => selectedIds.has(id));
    const next = new Set(selectedIds);
    for (const id of group.saved_search_ids) {
      if (allSelected) next.delete(id);
      else next.add(id);
    }
    setSelected([...next]);
  }

  async function handleCreateGroup(name: string, savedSearchIds: string[]) {
    await createSearchGroup(name, savedSearchIds);
    await refresh();
  }

  async function handleDeleteGroup(id: string) {
    await deleteSearchGroup(id);
    await refresh();
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500 text-white">
              <CarIcon className="h-5 w-5" />
            </span>
            <div className="leading-tight">
              <h1 className="hidden font-bold tracking-tight min-[400px]:block">MotoHunt</h1>
              <p className="hidden text-xs text-neutral-500 sm:block">UAE used cars</p>
            </div>
          </div>
          <div className="ml-auto">
            <ScrapeStatusPill scrape={scrape} onClick={() => setTab("settings")} />
          </div>
          <nav className="flex gap-0.5 sm:gap-1" role="tablist" aria-label="Sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={tabClass(tab === t.id)}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {loadError ? (
          <ErrorNote>Couldn&apos;t load your saved searches: {loadError}</ErrorNote>
        ) : !loaded ? (
          <CardGridSkeleton />
        ) : tab === "results" ? (
          <div className="space-y-6">
            {showNewSearch && <FilterBar onSave={handleSaveSearch} onClose={() => setShowNewSearch(false)} />}
            <SavedSearchPicker
              savedSearches={savedSearches}
              groups={groups}
              selectedIds={selectedIds}
              onToggleSearch={toggleSearch}
              onToggleGroup={toggleGroup}
              onClearSelection={() => setSelected([])}
              onCreateGroup={handleCreateGroup}
              onNewSearch={() => setShowNewSearch(true)}
              newSearchOpen={showNewSearch}
            />
            <ResultsTab
              selectedSearches={selectedSearches}
              lastVisit={lastVisit}
              onClearSelection={() => setSelected([])}
              deals={deals}
              scrape={scrape}
            />
          </div>
        ) : tab === "favorites" ? (
          <FavoritesTab deals={deals} scrape={scrape} />
        ) : (
          <SettingsTab
            savedSearches={savedSearches}
            groups={groups}
            scrape={scrape}
            onUpdateSearch={handleUpdateSearch}
            onDeleteSearch={handleDeleteSearch}
            onDeleteGroup={handleDeleteGroup}
          />
        )}
      </main>
    </div>
  );
}
