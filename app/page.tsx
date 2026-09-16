"use client";

import { useEffect, useMemo, useState } from "react";
import { FilterBar } from "./components/FilterBar";
import { SavedSearchPicker } from "./components/SavedSearchPicker";
import { ResultsTab } from "./components/ResultsTab";
import { FavoritesTab } from "./components/FavoritesTab";
import { SettingsTab } from "./components/SettingsTab";
import type { SavedSearchRow } from "../lib/supabase/types";
import {
  createSavedSearch,
  createSearchGroup,
  deleteSavedSearch,
  deleteSearchGroup,
  fetchSavedSearches,
  fetchSearchGroups,
  type SavedSearchInput,
  type SearchGroupWithMembers,
} from "../lib/supabase/queries";

type Tab = "results" | "favorites" | "settings";

function tabClass(active: boolean): string {
  return `border-b-2 px-4 py-2 text-sm font-medium ${
    active
      ? "border-neutral-900 text-neutral-900 dark:border-neutral-100 dark:text-neutral-100"
      : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300"
  }`;
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("results");
  const [savedSearches, setSavedSearches] = useState<SavedSearchRow[]>([]);
  const [groups, setGroups] = useState<SearchGroupWithMembers[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function refresh() {
    const [searches, gs] = await Promise.all([fetchSavedSearches(), fetchSearchGroups()]);
    setSavedSearches(searches);
    setGroups(gs);
  }

  useEffect(() => {
    refresh()
      .then(() => setLoaded(true))
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSaveSearch(input: SavedSearchInput) {
    await createSavedSearch(input);
    await refresh();
  }

  async function handleDeleteSearch(id: string) {
    await deleteSavedSearch(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    await refresh();
  }

  function toggleSearch(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(group: SearchGroupWithMembers) {
    setSelectedIds((prev) => {
      const allSelected = group.saved_search_ids.length > 0 && group.saved_search_ids.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of group.saved_search_ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  async function handleCreateGroup(name: string, savedSearchIds: string[]) {
    await createSearchGroup(name, savedSearchIds);
    await refresh();
  }

  async function handleDeleteGroup(id: string) {
    await deleteSearchGroup(id);
    await refresh();
  }

  const selectedSearches = useMemo(
    () => savedSearches.filter((s) => selectedIds.has(s.id)),
    [savedSearches, selectedIds]
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold">MotoHunt</h1>
      <p className="mb-6 text-sm text-neutral-500">UAE used-car listings, scraped every 6 hours.</p>

      {loadError && <p className="mb-4 text-sm text-red-600">{loadError}</p>}

      <div className="mb-6 space-y-4">
        <FilterBar onSave={handleSaveSearch} />
        <SavedSearchPicker
          savedSearches={savedSearches}
          groups={groups}
          selectedIds={selectedIds}
          onToggleSearch={toggleSearch}
          onToggleGroup={toggleGroup}
          onDeleteSearch={handleDeleteSearch}
          onCreateGroup={handleCreateGroup}
          onDeleteGroup={handleDeleteGroup}
        />
      </div>

      <div className="mb-4 flex border-b border-neutral-200 dark:border-neutral-800">
        <button className={tabClass(tab === "results")} onClick={() => setTab("results")}>
          Results
        </button>
        <button className={tabClass(tab === "favorites")} onClick={() => setTab("favorites")}>
          Favorites
        </button>
        <button className={tabClass(tab === "settings")} onClick={() => setTab("settings")}>
          Settings
        </button>
      </div>

      {!loaded ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : tab === "results" ? (
        <ResultsTab selectedSearches={selectedSearches} />
      ) : tab === "favorites" ? (
        <FavoritesTab />
      ) : (
        <SettingsTab />
      )}
    </main>
  );
}
