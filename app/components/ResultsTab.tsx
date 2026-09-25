"use client";

import { useEffect, useMemo, useState } from "react";
import type { BlockedModelRow, ListingRow, SavedSearchRow, ScrapeStatus } from "../../lib/supabase/types";
import { clearListingStatus, fetchListingsByKeys, fetchResults, setListingStatus } from "../../lib/supabase/queries";
import { groupDuplicates, isBlocked, isGroupGone, isGroupRanked, priceChange, type Deal, type ListingGroup } from "../../lib/listingInsights";
import { ListingCard } from "./ListingCard";
import { BanIcon, EyeOffIcon, HeartIcon, SearchIcon } from "./icons";
import {
  CardGridSkeleton,
  EmptyState,
  ErrorNote,
  errorMessage,
  ghostButtonClass,
  inputClass,
  secondaryButtonClass,
  usePersistentState,
  useToast,
} from "./ui";

type SortKey = "date" | "deal" | "price" | "price_desc" | "km" | "year";
type Toggle = "new" | "drops" | "deals";

type Props = {
  selectedSearches: SavedSearchRow[];
  /** Previous visit time, read once per page load by the parent (null = first visit ever). */
  lastVisit: string | null;
  onClearSelection: () => void;
  deals: Map<string, Deal>;
  scrape: ScrapeStatus | null;
  /** Ranked ads live on the Rank tab (even if never favorited), so they're left out here. */
  rankedLinks: Set<string>;
  /** Makes/models kept out of results (see Settings). */
  blocked: BlockedModelRow[];
  onBlock: (make: string, model: string) => void;
  /** Changes when the user hits Refresh - refetch without resetting filters. */
  reloadKey: number;
  /** Cars just restored from Hidden - shown in their own strip whatever the filters/blocks. */
  restoredKeys: string[];
  onClearRestored: (keys?: string[]) => void;
};

function matchesQuery(g: ListingGroup, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [g.primary, ...g.others]
    .map((l) => `${l.year ?? ""} ${l.make} ${l.model} ${l.source} ${l.country_of_make ?? ""} ${l.description ?? ""}`)
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

const hasDrop = (g: ListingGroup) => (priceChange(g.primary)?.delta ?? 0) < 0;

const selectClass = `${inputClass} w-auto py-1.5 pr-8`;

function ToggleChip({
  active,
  onClick,
  tone,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  tone: "emerald" | "sky";
  children: React.ReactNode;
  title: string;
}) {
  const tones = {
    emerald: active
      ? "bg-emerald-600 text-white"
      : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-950 dark:text-emerald-300",
    sky: active
      ? "bg-sky-600 text-white"
      : "bg-sky-100 text-sky-700 hover:bg-sky-200 dark:bg-sky-950 dark:text-sky-300",
  };
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

export function ResultsTab({
  selectedSearches,
  lastVisit,
  onClearSelection,
  deals,
  scrape,
  rankedLinks,
  blocked,
  onBlock,
  reloadKey,
  restoredKeys,
  onClearRestored,
}: Props) {
  const { notify } = useToast();
  const [listings, setListings] = useState<ListingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = usePersistentState<SortKey>("motohunt.sort", "date");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [toggle, setToggle] = useState<Toggle | null>(null);

  const selectionKey = selectedSearches
    .map((s) => s.id)
    .sort()
    .join(",");

  useEffect(() => {
    let cancelled = false;
    setListings(null);
    setError(null);
    fetchResults(selectedSearches)
      .then((rows) => !cancelled && setListings(rows))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, reloadKey]);

  const [restored, setRestored] = useState<ListingRow[]>([]);
  const restoredKeyList = restoredKeys.join(",");
  useEffect(() => {
    let cancelled = false;
    fetchListingsByKeys(restoredKeys)
      .then((rows) => !cancelled && setRestored(rows))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoredKeyList, reloadKey]);
  const restoredSet = useMemo(() => new Set(restoredKeys), [restoredKeys]);
  const restoredGroups = useMemo(
    () =>
      groupDuplicates(restored.filter((l) => restoredSet.has(l.unique_key))).filter(
        (g) => !isGroupRanked(g, rankedLinks)
      ),
    [restored, restoredSet, rankedLinks]
  );

  // Restored cars live in the strip above, not the main grid.
  const unranked = useMemo(
    () =>
      groupDuplicates(listings ?? []).filter(
        (g) => !isGroupRanked(g, rankedLinks) && !g.keys.some((k) => restoredSet.has(k))
      ),
    [listings, rankedLinks, restoredSet]
  );
  const groups = useMemo(() => unranked.filter((g) => !isBlocked(g.primary, blocked)), [unranked, blocked]);
  const blockedCount = unranked.length - groups.length;

  const isNew = (g: ListingGroup) => !!lastVisit && g.firstSeenAt > lastVisit;
  const dealOf = (g: ListingGroup) => deals.get(g.primary.unique_key);
  const isDeal = (g: ListingGroup) => {
    const label = dealOf(g)?.label;
    return label === "great" || label === "good";
  };

  const counts = useMemo(
    () => ({
      new: groups.filter(isNew).length,
      drops: groups.filter(hasDrop).length,
      deals: groups.filter(isDeal).length,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, lastVisit, deals]
  );

  const sources = useMemo(() => [...new Set((listings ?? []).map((l) => l.source))].sort(), [listings]);

  const visible = useMemo(() => {
    const filtered = groups.filter(
      (g) =>
        (source === "all" || [g.primary, ...g.others].some((l) => l.source === source)) &&
        (toggle !== "new" || isNew(g)) &&
        (toggle !== "drops" || hasDrop(g)) &&
        (toggle !== "deals" || isDeal(g)) &&
        matchesQuery(g, query)
    );
    return filtered.sort((ga, gb) => {
      const a = ga.primary;
      const b = gb.primary;
      switch (sort) {
        case "deal":
          return (dealOf(ga)?.deltaPct ?? Infinity) - (dealOf(gb)?.deltaPct ?? Infinity);
        case "price":
          return (a.price ?? Infinity) - (b.price ?? Infinity);
        case "price_desc":
          return (b.price ?? -Infinity) - (a.price ?? -Infinity);
        case "km":
          return (a.km ?? Infinity) - (b.km ?? Infinity);
        case "year":
          return (b.year ?? 0) - (a.year ?? 0);
        default:
          return gb.firstSeenAt.localeCompare(ga.firstSeenAt);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, source, toggle, query, sort, lastVisit, deals]);

  /** Optimistically removes the card (all copies of the car), persists, and offers an undo. */
  async function triage(group: ListingGroup, status: "favorited" | "disliked") {
    const members = [group.primary, ...group.others];
    const keys = new Set(group.keys);
    const restore = () =>
      setListings((prev) => (prev ? [...prev.filter((l) => !keys.has(l.unique_key)), ...members] : prev));

    setListings((prev) => prev?.filter((l) => !keys.has(l.unique_key)) ?? prev);
    try {
      await setListingStatus(group.keys, status);
      onClearRestored(group.keys); // dealt with - leaves the "Just restored" strip
      notify(status === "favorited" ? "Saved to favorites" : "Listing hidden", {
        onUndo: async () => {
          restore();
          try {
            await clearListingStatus(group.keys);
          } catch (e) {
            notify(`Couldn't undo: ${errorMessage(e)}`, { tone: "error" });
          }
        },
      });
    } catch (e) {
      restore();
      notify(`Couldn't update listing: ${errorMessage(e)}`, { tone: "error" });
    }
  }

  const resetFilters = () => {
    setQuery("");
    setSource("all");
    setToggle(null);
  };
  const flip = (t: Toggle) => setToggle(toggle === t ? null : t);

  function cardActions(group: ListingGroup) {
    return (
      <>
        <button
          className={`${ghostButtonClass} hover:!text-rose-600`}
          onClick={() => triage(group, "favorited")}
          title="Move to Favorites"
        >
          <HeartIcon /> Favorite
        </button>
        <button
          className={ghostButtonClass}
          onClick={() => triage(group, "disliked")}
          title={group.others.length > 0 ? "Hide this car (all its listings)" : "Hide this listing (undo from Settings)"}
        >
          <EyeOffIcon /> Hide
        </button>
        <button
          className={`${ghostButtonClass} px-2 hover:!text-red-600`}
          onClick={() => onBlock(group.primary.make, group.primary.model)}
          title={`Never show any ${group.primary.make} ${group.primary.model} in results (undo in Settings)`}
          aria-label={`Block all ${group.primary.make} ${group.primary.model}`}
        >
          <BanIcon />
        </button>
      </>
    );
  }

  /** Why a restored car wouldn't be in the normal grid - so it's no surprise when it's gone next time. */
  const restoredNote = (g: ListingGroup): string => {
    if (isBlocked(g.primary, blocked)) return "Restored · this model is blocked, so it only shows here";
    if (new Date(g.primary.expires_at).getTime() <= Date.now()) return "Restored · this ad has expired from MotoHunt";
    if (listings && !listings.some((l) => g.keys.includes(l.unique_key))) return "Restored · outside the selected saved searches";
    return "Restored";
  };

  const strip =
    restoredGroups.length > 0 ? (
      <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-baseline gap-2 font-semibold">
            Just restored
            <span className="text-sm font-medium tabular-nums text-neutral-400">{restoredGroups.length}</span>
          </h2>
          <button className={ghostButtonClass} onClick={() => onClearRestored()} title="Move these back into the normal results">
            Clear
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {restoredGroups.map((group) => (
            <ListingCard
              key={group.primary.unique_key}
              group={group}
              isNew={false}
              deal={dealOf(group)}
              gone={isGroupGone(group, scrape)}
              note={restoredNote(group)}
              actions={cardActions(group)}
            />
          ))}
        </div>
      </section>
    ) : null;

  const withStrip = (node: React.ReactNode) => (
    <div className="space-y-6">
      {strip}
      {node}
    </div>
  );

  if (error) return withStrip(<ErrorNote>{error}</ErrorNote>);
  if (listings === null) return withStrip(<CardGridSkeleton />);

  if (listings.length === 0) {
    return withStrip(
      <EmptyState title={selectedSearches.length > 0 ? "No listings match these searches" : "No listings yet"}>
        {selectedSearches.length > 0 ? (
          <>
            Nothing current matches the selected searches.{" "}
            <button className="font-medium text-orange-600 hover:underline" onClick={onClearSelection}>
              Show all listings
            </button>
          </>
        ) : (
          "The scraper runs every 3 hours — new matches for your saved searches will show up here."
        )}
      </EmptyState>
    );
  }

  const narrowed = query.trim() !== "" || source !== "all" || toggle !== null;
  const dupes = listings.length - groups.length;

  return withStrip(
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-neutral-400">
            <SearchIcon />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Narrow results — e.g. “gxr 2020” or “hybrid”"
            aria-label="Narrow results"
            className={`${inputClass} py-1.5 pl-9`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sources.length > 1 && (
            <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source" className={selectClass}>
              <option value="all">All sources</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort"
            className={selectClass}
          >
            <option value="date">Newest found</option>
            <option value="deal">Best deal first</option>
            <option value="price">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="km">Mileage: low to high</option>
            <option value="year">Year: newest first</option>
          </select>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-neutral-500">
        <span className="mr-1 tabular-nums" title={dupes > 0 ? `${dupes} duplicate listing(s) merged into their car` : undefined}>
          {narrowed ? `${visible.length} of ${groups.length}` : groups.length} car{groups.length === 1 ? "" : "s"}
          {dupes > 0 && <span className="text-neutral-400"> · {listings.length} listings</span>}
        </span>
        {counts.new > 0 && (
          <ToggleChip active={toggle === "new"} onClick={() => flip("new")} tone="emerald" title="New since your last visit">
            {counts.new} new
          </ToggleChip>
        )}
        {counts.drops > 0 && (
          <ToggleChip active={toggle === "drops"} onClick={() => flip("drops")} tone="sky" title="Cheaper than when first seen">
            ↓ {counts.drops} price drop{counts.drops === 1 ? "" : "s"}
          </ToggleChip>
        )}
        {counts.deals > 0 && (
          <ToggleChip
            active={toggle === "deals"}
            onClick={() => flip("deals")}
            tone="emerald"
            title="At least 4% below the median of similar cars"
          >
            {counts.deals} good deal{counts.deals === 1 ? "" : "s"}
          </ToggleChip>
        )}
        {blockedCount > 0 && (
          <span className="text-neutral-400" title="Unblock models in Settings to see these again">
            {blockedCount} hidden by blocked models
          </span>
        )}
        {narrowed && (
          <button
            className="ml-auto text-sm font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            onClick={resetFilters}
          >
            Reset filters
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState title="Nothing matches those filters">
          <button className={`${secondaryButtonClass} mt-3`} onClick={resetFilters}>
            Reset filters
          </button>
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((group) => (
            <ListingCard
              key={group.primary.unique_key}
              group={group}
              isNew={isNew(group)}
              deal={dealOf(group)}
              gone={isGroupGone(group, scrape)}
              actions={cardActions(group)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
