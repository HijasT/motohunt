"use client";

import { useEffect, useState } from "react";
import type { ListingRow, SavedSearchRow } from "../../lib/supabase/types";
import { fetchResults, getLastVisit, markVisitedNow, setListingStatus } from "../../lib/supabase/queries";
import { ListingCard, actionButtonClass } from "./ListingCard";

type SortKey = "date" | "price" | "km" | "year";

type Props = {
  selectedSearches: SavedSearchRow[];
};

export function ResultsTab({ selectedSearches }: Props) {
  const [listings, setListings] = useState<ListingRow[] | null>(null);
  const [lastVisit, setLastVisit] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("date");
  const [error, setError] = useState<string | null>(null);

  const selectionKey = selectedSearches
    .map((s) => s.id)
    .sort()
    .join(",");

  useEffect(() => {
    let cancelled = false;
    setListings(null);
    setError(null);

    (async () => {
      try {
        // Read the previous visit time first so this load's own badges are computed
        // against it, then bump it - otherwise every load would erase its own "new".
        const [previousVisit, rows] = await Promise.all([getLastVisit(), fetchResults(selectedSearches)]);
        if (cancelled) return;
        setLastVisit(previousVisit);
        setListings(rows);
        await markVisitedNow();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  async function handleDislike(uniqueKey: string) {
    setListings((prev) => prev?.filter((l) => l.unique_key !== uniqueKey) ?? prev);
    await setListingStatus(uniqueKey, "disliked");
  }

  async function handleFavorite(uniqueKey: string) {
    setListings((prev) => prev?.filter((l) => l.unique_key !== uniqueKey) ?? prev);
    await setListingStatus(uniqueKey, "favorited");
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (listings === null) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (listings.length === 0) {
    return <p className="text-sm text-neutral-500">No listings match yet. The scraper runs every 6 hours.</p>;
  }

  const sorted = [...listings].sort((a, b) => {
    switch (sort) {
      case "price":
        return (a.price ?? Infinity) - (b.price ?? Infinity);
      case "km":
        return (a.km ?? Infinity) - (b.km ?? Infinity);
      case "year":
        return (b.year ?? 0) - (a.year ?? 0);
      default:
        return new Date(b.first_seen_at).getTime() - new Date(a.first_seen_at).getTime();
    }
  });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-neutral-500">
          {listings.length} listing{listings.length === 1 ? "" : "s"}
        </p>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="date">Newest first</option>
          <option value="price">Price: low to high</option>
          <option value="km">Mileage: low to high</option>
          <option value="year">Year: newest first</option>
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((listing) => (
          <ListingCard
            key={listing.unique_key}
            listing={listing}
            isNew={!!lastVisit && new Date(listing.first_seen_at) > new Date(lastVisit)}
            actions={
              <>
                <button className={actionButtonClass} onClick={() => handleFavorite(listing.unique_key)}>
                  ☆ Favorite
                </button>
                <button className={actionButtonClass} onClick={() => handleDislike(listing.unique_key)}>
                  ✕ Dislike
                </button>
              </>
            }
          />
        ))}
      </div>
    </div>
  );
}
