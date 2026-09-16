"use client";

import { useEffect, useState } from "react";
import type { ListingRow } from "../../lib/supabase/types";
import { clearListingStatus, fetchDisliked } from "../../lib/supabase/queries";
import { ListingCard, actionButtonClass } from "./ListingCard";

export function SettingsTab() {
  const [listings, setListings] = useState<ListingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDisliked()
      .then((rows) => !cancelled && setListings(rows))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUndislike(uniqueKey: string) {
    setListings((prev) => prev?.filter((l) => l.unique_key !== uniqueKey) ?? prev);
    await clearListingStatus(uniqueKey);
  }

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold text-neutral-500">Disliked listings</h2>
      <p className="mb-3 text-sm text-neutral-500">
        Saved searches and groups are managed from the filter bar above (hover a chip to delete it). Undo a dislike
        here to bring a listing back to Results.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {listings === null ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : listings.length === 0 ? (
        <p className="text-sm text-neutral-500">Nothing disliked.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing) => (
            <ListingCard
              key={listing.unique_key}
              listing={listing}
              isNew={false}
              actions={
                <button className={actionButtonClass} onClick={() => handleUndislike(listing.unique_key)}>
                  ↺ Un-dislike
                </button>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
