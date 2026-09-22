"use client";

import type { ReactNode } from "react";
import type { LinkCheckRow, ListingRow } from "../../lib/supabase/types";
import { priceChange, type Deal, type ListingGroup } from "../../lib/listingInsights";
import { ExternalIcon } from "./icons";
import { focusRing, formatNumber, ghostButtonClass, panelClass, timeAgo } from "./ui";

type Props = {
  group: ListingGroup;
  isNew: boolean;
  deal?: Deal;
  /** Not seen by recent scraper runs - probably sold. */
  gone?: boolean;
  /** Link check found the ad sold/removed - stronger than `gone`, shown instead of it. */
  sold?: LinkCheckRow;
  actions?: ReactNode;
};

function Spec({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
      {children}
    </span>
  );
}

const DEAL_STYLE: Record<Deal["label"], string> = {
  great: "bg-emerald-600 text-white",
  good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  fair: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  high: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

export function DealChip({ deal, listing }: { deal: Deal; listing: ListingRow }) {
  const pct = Math.round(Math.abs(deal.deltaPct) * 100);
  const text =
    deal.label === "fair" ? "Fair price" : `${pct}% ${deal.deltaPct < 0 ? "below" : "above"} market`;
  const years = listing.year ? `${listing.year - 1}–${listing.year + 1} ` : "";
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-xs font-semibold ${DEAL_STYLE[deal.label]}`}
      title={`Expected ≈ AED ${formatNumber(Math.round(deal.expected / 100) * 100)} ${
        deal.mileageAdjusted ? "for this mileage" : "(median price)"
      }, based on ${deal.comparables} similar ${years}${listing.make} ${listing.model} cars.`}
    >
      {text}
    </span>
  );
}

function PriceLine({ listing }: { listing: ListingRow }) {
  const change = priceChange(listing);
  if (listing.price === null) {
    return <p className="mt-1 text-base font-medium text-neutral-400">Price on request</p>;
  }
  return (
    <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
      <p className="text-2xl font-bold tabular-nums tracking-tight">
        <span className="mr-1 text-sm font-medium text-neutral-500">AED</span>
        {formatNumber(listing.price)}
      </p>
      {change && (
        <span
          className={`text-sm font-semibold tabular-nums ${
            change.delta < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
          }`}
          title={`First seen at AED ${formatNumber(change.from)}${
            change.at ? `; last change ${new Date(change.at).toLocaleDateString()}` : ""
          }`}
        >
          {change.delta < 0 ? "↓" : "↑"} {formatNumber(Math.abs(change.delta))}
          <span className="ml-1.5 font-normal text-neutral-400 line-through">{formatNumber(change.from)}</span>
        </span>
      )}
    </div>
  );
}

export function ListingCard({ group, isNew, deal, gone, sold, actions }: Props) {
  const listing = group.primary;
  const title = [listing.make, listing.model].filter(Boolean).join(" ");

  return (
    <article
      className={`${panelClass} group flex flex-col transition hover:border-neutral-300 hover:shadow-md dark:hover:border-neutral-700 ${
        sold ? "!border-red-300 dark:!border-red-900" : isNew ? "ring-1 ring-emerald-500/40" : ""
      }`}
    >
      <div className={`flex flex-1 flex-col gap-3 p-4 ${gone || sold ? "opacity-60" : ""}`}>
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold uppercase tracking-wider text-neutral-500">{listing.source}</span>
            {isNew && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                New
              </span>
            )}
          </div>
          {sold ? (
            <SoldTag check={sold} />
          ) : gone ? (
            <span
              className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300"
              title={`Last seen ${new Date(listing.last_seen_at).toLocaleString()}. Recent scrapes haven't found it — likely sold, or no saved search covers it any more.`}
            >
              Not seen {timeAgo(listing.last_seen_at)}
            </span>
          ) : (
            <time
              dateTime={listing.first_seen_at}
              title={`First seen ${new Date(group.firstSeenAt).toLocaleString()}`}
              className="text-neutral-400"
            >
              {timeAgo(group.firstSeenAt)}
            </time>
          )}
        </div>

        <div>
          <h3 className="text-base font-semibold leading-snug text-neutral-900 dark:text-neutral-50">
            <a href={listing.link} target="_blank" rel="noreferrer" className={`rounded hover:underline ${focusRing}`}>
              {title || "Unknown car"}
            </a>
          </h3>
          <PriceLine listing={listing} />
        </div>

        <div className="flex flex-wrap gap-1.5 tabular-nums">
          {deal && deal.label !== "fair" && <DealChip deal={deal} listing={listing} />}
          {listing.year !== null && <Spec>{listing.year}</Spec>}
          {listing.km !== null && <Spec>{formatNumber(listing.km)} km</Spec>}
          {listing.country_of_make && <Spec>{listing.country_of_make}</Spec>}
        </div>

        {listing.description && (
          <p className="line-clamp-2 text-sm text-neutral-500 dark:text-neutral-400">{listing.description}</p>
        )}

        {group.others.length > 0 && (
          <div className="rounded-lg bg-neutral-50 px-3 py-2 text-sm dark:bg-neutral-800/50">
            <p className="mb-1 text-xs font-medium text-neutral-500">
              Also listed {group.others.length === 1 ? "once more" : `${group.others.length} more times`}
            </p>
            <ul className="space-y-0.5">
              {group.others.map((o) => (
                <li key={o.unique_key}>
                  <a
                    href={o.link}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-neutral-700 hover:underline dark:text-neutral-300"
                  >
                    <span className="font-medium">{o.source === listing.source ? `${o.source} (repost)` : o.source}</span>
                    <span className="tabular-nums text-neutral-500">
                      {o.price === null ? "no price" : `AED ${formatNumber(o.price)}`}
                      {o.price !== null && listing.price !== null && o.price > listing.price && (
                        <span className="text-neutral-400"> (+{formatNumber(o.price - listing.price)})</span>
                      )}
                    </span>
                    <ExternalIcon className="ml-auto h-3.5 w-3.5 text-neutral-400" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-neutral-100 px-2 py-1.5 dark:border-neutral-800">
        {actions}
        <a
          href={listing.link}
          target="_blank"
          rel="noreferrer"
          className={`${ghostButtonClass} ml-auto text-neutral-900 dark:text-neutral-100`}
        >
          View ad <ExternalIcon />
        </a>
      </div>
    </article>
  );
}

export function SoldTag({ check }: { check: LinkCheckRow }) {
  return (
    <span
      className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950 dark:text-red-300"
      title={`Link check ${timeAgo(check.checked_at)}: ${check.detail ?? "ad no longer available"}${
        check.gone_since ? ` (first seen gone ${new Date(check.gone_since).toLocaleDateString()})` : ""
      }`}
    >
      Sold / removed
    </span>
  );
}
