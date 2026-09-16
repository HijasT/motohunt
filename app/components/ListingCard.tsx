"use client";

import type { ReactNode } from "react";
import type { ListingRow } from "../../lib/supabase/types";

export const actionButtonClass =
  "rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800";

type Props = {
  listing: ListingRow;
  isNew: boolean;
  actions?: ReactNode;
};

function formatNumber(n: number | null): string {
  return n === null ? "—" : n.toLocaleString("en-US");
}

export function ListingCard({ listing, isNew, actions }: Props) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">{listing.source}</span>
            {isNew && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                NEW
              </span>
            )}
          </div>
          <h3 className="text-lg font-semibold leading-tight">
            {listing.year ?? "—"} {listing.make} {listing.model}
          </h3>
        </div>
        <a
          href={listing.link}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900"
        >
          View ad ↗
        </a>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-600 dark:text-neutral-400">
        <span>AED {formatNumber(listing.price)}</span>
        <span>{formatNumber(listing.km)} km</span>
        {listing.country_of_make && <span>{listing.country_of_make}</span>}
      </div>

      {listing.description && (
        <p className="line-clamp-2 text-sm text-neutral-500">{listing.description}</p>
      )}

      {actions && <div className="mt-1 flex gap-2">{actions}</div>}
    </div>
  );
}
