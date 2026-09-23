"use client";

import { useEffect, useMemo, useState } from "react";
import { FilterBar } from "./components/FilterBar";
import { SavedSearchPicker } from "./components/SavedSearchPicker";
import { ResultsTab } from "./components/ResultsTab";
import { FavoritesTab } from "./components/FavoritesTab";
import { SettingsTab } from "./components/SettingsTab";
import { RankTab } from "./components/RankTab";
import { RankDialog } from "./components/RankDialog";
import { ScrapeStatusPill } from "./components/ScrapeHealth";
import { CarIcon, RefreshIcon } from "./components/icons";
import { CardGridSkeleton, ErrorNote, ToastProvider, errorMessage, focusRing, usePersistentState, useToast } from "./components/ui";
import type {
  BlockedModelRow,
  LinkCheckRow,
  ListingRow,
  RankingRow,
  SavedSearchRow,
  ScrapeStatus,
} from "../lib/supabase/types";
import { computeDeals, findBlock, normLink, type ListingGroup } from "../lib/listingInsights";
import {
  addBlockedModel,
  addRanking,
  fetchBlockedModels,
  removeBlockedModel,
  createSavedSearch,
  createSearchGroup,
  deleteSavedSearch,
  deleteSearchGroup,
  fetchLinkChecks,
  fetchMarketListings,
  fetchRankings,
  setRankOrder,
  fetchSavedSearches,
  fetchSearchGroups,
  getLastVisit,
  getScrapeStatus,
  markVisitedNow,
  updateSavedSearch,
  type SavedSearchInput,
  type SearchGroupWithMembers,
} from "../lib/supabase/queries";

type Tab = "results" | "rank" | "favorites" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "results", label: "Results" },
  { id: "rank", label: "Rank" },
  { id: "favorites", label: "Favorites" },
  { id: "settings", label: "Settings" },
];

function tabClass(active: boolean): string {
  return `relative rounded-lg px-2 py-1.5 text-[13px] font-medium sm:px-3 sm:text-sm transition ${focusRing} ${
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
  const [rankings, setRankings] = useState<RankingRow[]>([]);
  const [rankingsError, setRankingsError] = useState<string | null>(null);
  const [linkCheckRows, setLinkCheckRows] = useState<LinkCheckRow[]>([]);
  const [blocked, setBlocked] = useState<BlockedModelRow[]>([]);
  /** Bumped by the Refresh button; tabs refetch their own data when it changes. */
  const [reloadKey, setReloadKey] = useState(0);
  const [reloading, setReloading] = useState(false);
  /** Favorite being ranked - the dialog asks for its list and position. */
  const [rankTarget, setRankTarget] = useState<ListingGroup | null>(null);

  async function refreshRankings() {
    try {
      setRankings(await fetchRankings());
      setRankingsError(null);
    } catch (e) {
      setRankingsError(errorMessage(e));
    }
  }

  /** Everything besides saved searches. Failures just leave that feature's badges off. */
  function loadSideData() {
    return Promise.all([
      getScrapeStatus().then(setScrape).catch(() => {}),
      fetchMarketListings().then(setMarket).catch(() => {}),
      refreshRankings(),
      fetchLinkChecks().then(setLinkCheckRows).catch(() => {}),
      fetchBlockedModels().then(setBlocked).catch(() => {}),
    ]);
  }

  /**
   * Reloads what MotoHunt already has in its database - new scrape results,
   * ranks written from the chat, link-check results, blocks made on another
   * device. It does NOT contact Dubizzle/CarSwitch/Cars24; that's the scheduled scrape.
   */
  async function reloadAll() {
    setReloading(true);
    try {
      await Promise.all([refresh(), loadSideData()]);
      setReloadKey((k) => k + 1);
    } catch (e) {
      notify(`Couldn't refresh: ${errorMessage(e)}`, { tone: "error" });
    } finally {
      setReloading(false);
    }
  }

  async function refresh() {
    const [searches, gs] = await Promise.all([fetchSavedSearches(), fetchSearchGroups()]);
    setSavedSearches(searches);
    setGroups(gs);
  }

  useEffect(() => {
    // Nice-to-haves: the header status and deal scores. Neither blocks the page, and
    // failures just mean those badges don't show (e.g. before the migration runs).
    void loadSideData();

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
  const linkChecks = useMemo(() => new Map(linkCheckRows.map((c) => [c.link_key, c])), [linkCheckRows]);
  const rankedLinks = useMemo(
    () => new Set(rankings.flatMap((r) => (r.link ? [normLink(r.link)] : []))),
    [rankings]
  );

  async function handleBlock(make: string, model: string | null) {
    const label = [make, model].filter(Boolean).join(" ");
    const existing = findBlock(make, model, blocked);
    if (existing) {
      notify(`${label} is already blocked${existing.model == null ? ` (all ${existing.make})` : ""}`);
      return;
    }
    try {
      const row = await addBlockedModel(make, model);
      setBlocked((prev) => [row, ...prev]);
      notify(`${model ? label : `All ${make}`} hidden from results`, {
        onUndo: async () => {
          setBlocked((prev) => prev.filter((b) => b.id !== row.id));
          await removeBlockedModel(row.id).catch((e) => notify(`Couldn't undo: ${errorMessage(e)}`, { tone: "error" }));
        },
      });
    } catch (e) {
      notify(`Couldn't block: ${errorMessage(e)}`, { tone: "error" });
    }
  }

  async function handleUnblock(row: BlockedModelRow) {
    setBlocked((prev) => prev.filter((b) => b.id !== row.id));
    try {
      await removeBlockedModel(row.id);
      notify(`${[row.make, row.model].filter(Boolean).join(" ")} will show in results again`);
    } catch (e) {
      setBlocked((prev) => [row, ...prev]);
      notify(`Couldn't unblock: ${errorMessage(e)}`, { tone: "error" });
    }
  }

  /** Inserts the car at `position` in `list`; cars from that slot down move one place lower. */
  async function handleRank(group: ListingGroup, list: string, position: number) {
    const l = group.primary;
    try {
      const inList = rankings.filter((r) => r.list === list); // already sorted by rank
      const row = await addRanking({
        list,
        link: l.link,
        rank: position,
        title: [l.year, l.make, l.model].filter(Boolean).join(" "),
        price: l.price,
        km: l.km,
      });
      const ordered = [...inList];
      ordered.splice(position - 1, 0, row);
      await setRankOrder(ordered); // renumbers the whole list 1..n
      await refreshRankings();
      setRankTarget(null);
      notify(`Ranked #${position} in ${list} — moved to the Rank tab for 30 days`);
    } catch (e) {
      await refreshRankings(); // show whatever did get saved, rather than a stale list
      notify(`Couldn't rank: ${errorMessage(e)}`, { tone: "error" });
    }
  }

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
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 sm:gap-3">
          <div className="hidden items-center gap-2 min-[400px]:flex">
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
          <div>
            <button
              onClick={reloadAll}
              disabled={reloading || !loaded}
              className={`flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 ${focusRing}`}
              title="Refresh - reload results from MotoHunt's database (doesn't re-scrape the car sites)"
              aria-label="Refresh"
            >
              <RefreshIcon className={`h-4 w-4 ${reloading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <nav className="flex min-w-0 gap-0.5 overflow-x-auto sm:gap-1" role="tablist" aria-label="Sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={tabClass(tab === t.id)}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.id === "rank" && rankings.length > 0 && (
                  <span className="ml-1 hidden tabular-nums opacity-60 sm:inline">{rankings.length}</span>
                )}
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
              reloadKey={reloadKey}
              selectedSearches={selectedSearches}
              lastVisit={lastVisit}
              onClearSelection={() => setSelected([])}
              deals={deals}
              scrape={scrape}
              rankedLinks={rankedLinks}
              blocked={blocked}
              onBlock={handleBlock}
            />
          </div>
        ) : tab === "rank" ? (
          <RankTab
            key={reloadKey}
            rankings={rankings}
            error={rankingsError}
            market={market}
            deals={deals}
            scrape={scrape}
            linkChecks={linkChecks}
            onChanged={refreshRankings}
          />
        ) : tab === "favorites" ? (
          <FavoritesTab
            key={reloadKey}
            deals={deals}
            scrape={scrape}
            rankedLinks={rankedLinks}
            onRank={setRankTarget}
            linkChecks={linkChecks}
          />
        ) : (
          <SettingsTab
            key={reloadKey}
            savedSearches={savedSearches}
            groups={groups}
            scrape={scrape}
            onUpdateSearch={handleUpdateSearch}
            onDeleteSearch={handleDeleteSearch}
            onDeleteGroup={handleDeleteGroup}
            blocked={blocked}
            onBlock={handleBlock}
            onUnblock={handleUnblock}
          />
        )}
      </main>

      {rankTarget && (
        <RankDialog
          group={rankTarget}
          rankings={rankings}
          onCancel={() => setRankTarget(null)}
          onConfirm={(list, position) => handleRank(rankTarget, list, position)}
        />
      )}
    </div>
  );
}
