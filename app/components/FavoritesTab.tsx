"use client";

import { useEffect, useMemo, useState } from "react";
import type { ListingRow, ScrapeStatus } from "../../lib/supabase/types";
import { clearListingStatus, fetchFavorites, setListingStatus } from "../../lib/supabase/queries";
import { groupDuplicates, isGroupGone, priceChange, type Deal, type ListingGroup } from "../../lib/listingInsights";
import { ListingCard } from "./ListingCard";
import { HeartIcon } from "./icons";
import { CardGridSkeleton, EmptyState, ErrorNote, errorMessage, ghostButtonClass, useToast } from "./ui";

type Props = {
  deals: Map<string, Deal>;
  scrape: ScrapeStatus | null;
};

export function FavoritesTab({ deals, scrape }: Props) {
  const { notify } = useToast();
  const [listings, setListings] = useState<ListingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFavorites()
      .then((rows) => !cancelled && setListings(rows))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => groupDuplicates(listings ?? []), [listings]);
  const goneCount = groups.filter((g) => isGroupGone(g, scrape)).length;
  const dropCount = groups.filter((g) => (priceChange(g.primary)?.delta ?? 0) < 0).length;

  async function handleUnfavorite(group: ListingGroup) {
    const keys = new Set(group.keys);
    const members = [group.primary, ...group.others];
    const index = listings?.findIndex((l) => keys.has(l.unique_key)) ?? 0;
    // Undo puts the car back where it was rather than at the end.
    const restore = () =>
      setListings((prev) => {
        if (!prev || prev.some((l) => keys.has(l.unique_key))) return prev;
        const next = [...prev];
        next.splice(Math.max(0, index), 0, ...members);
        return next;
      });

    setListings((prev) => prev?.filter((l) => !keys.has(l.unique_key)) ?? prev);
    try {
      await clearListingStatus(group.keys);
      notify("Removed from favorites — it's back in Results", {
        onUndo: async () => {
          restore();
          try {
            await setListingStatus(group.keys, "favorited");
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

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (listings === null) return <CardGridSkeleton count={3} />;
  if (groups.length === 0) {
    return (
      <EmptyState title="No favorites yet">
        Tap <span className="font-medium text-neutral-700 dark:text-neutral-300">Favorite</span> on a listing in
        Results to shortlist it here.
      </EmptyState>
    );
  }

  return (
    <div>
      <p className="mb-3 flex flex-wrap gap-x-3 text-sm tabular-nums text-neutral-500">
        <span>
          {groups.length} favorite{groups.length === 1 ? "" : "s"}
        </span>
        {dropCount > 0 && (
          <span className="font-medium text-emerald-600 dark:text-emerald-400">↓ {dropCount} got cheaper</span>
        )}
        {goneCount > 0 && (
          <span className="font-medium text-amber-600 dark:text-amber-400">{goneCount} not seen lately — may be sold</span>
        )}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((group) => (
          <ListingCard
            key={group.primary.unique_key}
            group={group}
            isNew={false}
            deal={deals.get(group.primary.unique_key)}
            gone={isGroupGone(group, scrape)}
            actions={
              <button
                className={`${ghostButtonClass} text-rose-600 dark:text-rose-400`}
                onClick={() => handleUnfavorite(group)}
                title="Remove from favorites"
              >
                <HeartIcon filled /> Favorited
              </button>
            }
          />
        ))}
      </div>
    </div>
  );
}
