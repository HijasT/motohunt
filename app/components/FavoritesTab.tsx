"use client";

import { useEffect, useMemo, useState } from "react";
import type { LinkCheckRow, ListingRow, ScrapeStatus } from "../../lib/supabase/types";
import { fetchFavorites, setListingStatus } from "../../lib/supabase/queries";
import { groupDuplicates, isGroupGone, isGroupRanked, normLink, priceChange, type Deal, type ListingGroup } from "../../lib/listingInsights";
import { ListingCard } from "./ListingCard";
import { CopyIcon, TrashIcon, TrophyIcon } from "./icons";
import {
  CardGridSkeleton,
  EmptyState,
  ErrorNote,
  copyText,
  errorMessage,
  formatNumber,
  ghostButtonClass,
  useToast,
} from "./ui";

type Props = {
  deals: Map<string, Deal>;
  scrape: ScrapeStatus | null;
  /** Normalized links of currently ranked ads - those live on the Rank tab instead. */
  rankedLinks: Set<string>;
  /** Opens the "which list, which position?" dialog. */
  onRank: (group: ListingGroup) => void;
  /** Latest link-check result per normLink key. */
  linkChecks: Map<string, LinkCheckRow>;
};

/** A car counts as sold when the link check found every copy of it gone. */
function soldCheck(g: ListingGroup, linkChecks: Map<string, LinkCheckRow>): LinkCheckRow | undefined {
  const checks = [g.primary, ...g.others].map((l) => linkChecks.get(normLink(l.link)));
  return checks.every((c) => c?.status === "gone") ? checks[0] : undefined;
}

/** Same WhatsApp format as the Rank tab's Copy: *bold* heading, numbered cars, link under each. */
function favoritesAsText(groups: ListingGroup[], linkChecks: Map<string, LinkCheckRow>): string {
  const lines = ["*Favorites*"];
  groups.forEach((g, i) => {
    const l = g.primary;
    const title = [l.year, l.make, l.model].filter(Boolean).join(" ");
    const facts = [l.price == null ? null : `AED ${formatNumber(l.price)}`, l.km == null ? null : `${formatNumber(l.km)} km`]
      .filter(Boolean)
      .join(" · ");
    lines.push(`${i + 1}. ${title}${facts ? ` — ${facts}` : ""}${soldCheck(g, linkChecks) ? " (SOLD)" : ""}`);
    lines.push(l.link);
  });
  return lines.join("\n");
}

export function FavoritesTab({ deals, scrape, rankedLinks, onRank, linkChecks }: Props) {
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

  const allGroups = useMemo(() => groupDuplicates(listings ?? []), [listings]);
  // Sold ones first (stable sort keeps the rest in favorited order) - they need a decision.
  const groups = useMemo(
    () =>
      allGroups
        .filter((g) => !isGroupRanked(g, rankedLinks))
        .sort((a, b) => Number(!!soldCheck(b, linkChecks)) - Number(!!soldCheck(a, linkChecks))),
    [allGroups, rankedLinks, linkChecks]
  );
  const rankedCount = allGroups.length - groups.length;
  const goneCount = groups.filter((g) => isGroupGone(g, scrape)).length;
  const dropCount = groups.filter((g) => (priceChange(g.primary)?.delta ?? 0) < 0).length;
  const soldCount = groups.filter((g) => soldCheck(g, linkChecks)).length;

  /**
   * Removing a favorite hides the car (it doesn't drop back into Results) - once
   * you've looked at a car closely enough to favorite and then drop it, you're
   * done with it. Undo puts it back in the same spot; Settings → Hidden listings
   * can restore it later.
   */
  async function handleRemove(group: ListingGroup) {
    const keys = new Set(group.keys);
    const members = [group.primary, ...group.others];
    const index = listings?.findIndex((l) => keys.has(l.unique_key)) ?? 0;
    const restore = () =>
      setListings((prev) => {
        if (!prev || prev.some((l) => keys.has(l.unique_key))) return prev;
        const next = [...prev];
        next.splice(Math.max(0, index), 0, ...members);
        return next;
      });

    setListings((prev) => prev?.filter((l) => !keys.has(l.unique_key)) ?? prev);
    try {
      await setListingStatus(group.keys, "disliked");
      notify("Removed from Favorites and hidden", {
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
      notify(`Couldn't remove: ${errorMessage(e)}`, { tone: "error" });
    }
  }

  async function handleCopy() {
    const ok = await copyText(favoritesAsText(groups, linkChecks));
    notify(ok ? "Favorites copied — paste it into WhatsApp" : "Couldn't copy — your browser blocked clipboard access", {
      tone: ok ? "info" : "error",
    });
  }

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (listings === null) return <CardGridSkeleton count={3} />;
  if (groups.length === 0) {
    return (
      <EmptyState title={rankedCount > 0 ? "Every favorite is ranked" : "No favorites yet"}>
        {rankedCount > 0 ? (
          "Your ranked favorites are on the Rank tab. They come back here when their 30 days are up."
        ) : (
          <>
            Tap <span className="font-medium text-neutral-700 dark:text-neutral-300">Favorite</span> on a listing in
            Results to shortlist it here.
          </>
        )}
      </EmptyState>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
      <p className="flex flex-wrap gap-x-3 text-sm tabular-nums text-neutral-500">
        <span>
          {groups.length} favorite{groups.length === 1 ? "" : "s"}
        </span>
        {dropCount > 0 && (
          <span className="font-medium text-emerald-600 dark:text-emerald-400">↓ {dropCount} got cheaper</span>
        )}
        {soldCount > 0 && (
          <span className="font-semibold text-red-600 dark:text-red-400">
            {soldCount} sold or removed — review and remove
          </span>
        )}
        {rankedCount > 0 && <span>{rankedCount} more on the Rank tab</span>}
        {goneCount > 0 && (
          <span className="font-medium text-amber-600 dark:text-amber-400">{goneCount} not seen lately — may be sold</span>
        )}
      </p>
      <button className={`${ghostButtonClass} shrink-0`} onClick={handleCopy}>
        <CopyIcon /> Copy list
      </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((group) => (
          <ListingCard
            key={group.primary.unique_key}
            group={group}
            isNew={false}
            deal={deals.get(group.primary.unique_key)}
            gone={isGroupGone(group, scrape)}
            sold={soldCheck(group, linkChecks)}
            actions={
              <>
                <button
                  className={`${ghostButtonClass} ${
                    soldCheck(group, linkChecks) ? "!text-red-600 dark:!text-red-400" : "hover:!text-red-600"
                  }`}
                  onClick={() => handleRemove(group)}
                  title="Remove from Favorites and hide it (undo available; restore later from Settings)"
                >
                  <TrashIcon /> Remove
                </button>
                {!soldCheck(group, linkChecks) && (
                  <button
                    className={`${ghostButtonClass} hover:!text-orange-600`}
                    onClick={() => onRank(group)}
                    title="Rank it - choose the list and position (30 days)"
                  >
                    <TrophyIcon /> Rank
                  </button>
                )}
              </>
            }
          />
        ))}
      </div>
    </div>
  );
}
