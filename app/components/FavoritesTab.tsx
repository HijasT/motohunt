"use client";

import { useEffect, useState } from "react";
import type { ListingRow } from "../../lib/supabase/types";
import { clearListingStatus, fetchFavorites } from "../../lib/supabase/queries";
import { ListingCard, actionButtonClass } from "./ListingCard";

export function FavoritesTab() {
  const [listings, setListings] = useState<ListingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFavorites()
      .then((rows) => !cancelled && setListings(rows))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUnfavorite(uniqueKey: string) {
    setListings((prev) => prev?.filter((l) => l.unique_key !== uniqueKey) ?? prev);
    await clearListingStatus(uniqueKey);
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (listings === null) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (listings.length === 0) return <p className="text-sm text-neutral-500">No favorites yet.</p>;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {listings.map((listing) => (
        <ListingCard
          key={listing.unique_key}
          listing={listing}
          isNew={false}
          actions={
            <button className={actionButtonClass} onClick={() => handleUnfavorite(listing.unique_key)}>
              ★ Unfavorite
            </button>
          }
        />
      ))}
    </div>
  );
}
