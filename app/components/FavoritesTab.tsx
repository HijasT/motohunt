"use client";

import { useEffect, useMemo, useState } from "react";
import type { LinkCheckRow, ListingRow, RankDropoutRow, ScrapeStatus } from "../../lib/supabase/types";
import {
  deleteDropouts,
  fetchFavorites,
  restoreDropouts,
  restoreStatuses,
  setListingStatus,
  snapshotStatuses,
} from "../../lib/supabase/queries";
import {
  candidateFromDropout,
  candidateFromGroup,
  groupDuplicates,
  groupsByLink,
  isGroupGone,
  isGroupRanked,
  normLink,
  priceChange,
  type Deal,
  type ListingGroup,
  type RankCandidate,
} from "../../lib/listingInsights";
import { ListingCard, SoldTag } from "./ListingCard";
import { CopyIcon, ExternalIcon, TrashIcon, TrophyIcon } from "./icons";
import {
  CardGridSkeleton,
  EmptyState,
  ErrorNote,
  copyText,
  errorMessage,
  formatNumber,
  ghostButtonClass,
  panelClass,
  secondaryButtonClass,
  timeAgo,
  useToast,
} from "./ui";

type Props = {
  deals: Map<string, Deal>;
  scrape: ScrapeStatus | null;
  /** Normalized links of currently ranked ads - those live on the Rank tab instead. */
  rankedLinks: Set<string>;
  /** Opens the "which list, which position?" dialog. */
  onRank: (car: RankCandidate) => void;
  /** Latest link-check result per normLink key. */
  linkChecks: Map<string, LinkCheckRow>;
  /** Cars pushed out of a full rank list - shown in their own section on top. */
  dropouts: RankDropoutRow[];
  onDropoutsChanged: () => Promise<void>;
  /** Every live scraped listing - drop-outs are matched against these, not just favorites. */
  market: ListingRow[];
};

/** A car counts as sold when the link check found every copy of it gone. */
function soldCheck(g: ListingGroup, linkChecks: Map<string, LinkCheckRow>): LinkCheckRow | undefined {
  const checks = [g.primary, ...g.others].map((l) => linkChecks.get(normLink(l.link)));
  return checks.every((c) => c?.status === "gone") ? checks[0] : undefined;
}

function hostOf(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return link;
  }
}

/** One drop-out, matched to the favorited listing when MotoHunt scrapes that ad. */
type DropoutItem = { row: RankDropoutRow; group: ListingGroup | undefined };

function carLine(title: string, price: number | null, km: number | null, sold: boolean): string {
  const facts = [price == null ? null : `AED ${formatNumber(price)}`, km == null ? null : `${formatNumber(km)} km`]
    .filter(Boolean)
    .join(" · ");
  return `${title}${facts ? ` — ${facts}` : ""}${sold ? " (SOLD)" : ""}`;
}

/** Same WhatsApp format as the Rank tab's Copy: *bold* heading, numbered cars, link under each. */
function dropoutsAsText(dropouts: DropoutItem[], linkChecks: Map<string, LinkCheckRow>): string {
  const lines = ["*Dropped from ranking*"];
  dropouts.forEach(({ row, group }, i) => {
    const c = candidateFromDropout(row, group);
    const sold = !!(row.link && linkChecks.get(normLink(row.link))?.status === "gone");
    lines.push(`${i + 1}. ${carLine(c.title, c.price, c.km, sold)}`);
    lines.push(row.link ?? "(no link)");
  });
  return lines.join("\n");
}

function favoritesAsText(groups: ListingGroup[], linkChecks: Map<string, LinkCheckRow>): string {
  const lines = ["*Favorites*"];
  groups.forEach((g, i) => {
    const c = candidateFromGroup(g);
    lines.push(`${i + 1}. ${carLine(c.title, c.price, c.km, !!soldCheck(g, linkChecks))}`);
    lines.push(g.primary.link);
  });
  return lines.join("\n");
}

export function FavoritesTab({
  deals,
  scrape,
  rankedLinks,
  onRank,
  linkChecks,
  dropouts,
  onDropoutsChanged,
  market,
}: Props) {
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

  const allGroups = useMemo(
    () => groupDuplicates(listings ?? []).filter((g) => !isGroupRanked(g, rankedLinks)),
    [listings, rankedLinks]
  );

  // Split: drop-outs vs. ordinary favorites. A drop-out is matched to its scraped
  // listing by ad link - favorites first, then any live listing (a dropped car
  // needn't currently be a favorite) - or shown from the saved rank details if
  // MotoHunt doesn't scrape that ad at all.
  const marketByLink = useMemo(() => groupsByLink(market), [market]);
  const { dropoutItems, groups } = useMemo(() => {
    const favByKey = new Map<string, ListingGroup>();
    for (const g of allGroups) for (const l of [g.primary, ...g.others]) favByKey.set(normLink(l.link), g);
    const items: DropoutItem[] = [];
    const takenFavs = new Set<ListingGroup>();
    const seen = new Set<string>();
    for (const row of dropouts) {
      const key = row.link ? normLink(row.link) : null;
      if (key && rankedLinks.has(key)) continue; // ranked again - lives on the Rank tab
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      const fav = key ? favByKey.get(key) : undefined;
      if (fav) takenFavs.add(fav);
      items.push({ row, group: fav ?? (key ? marketByLink.get(key) : undefined) });
    }
    // Sold ones first (stable sort keeps the rest in favorited order) - they need a decision.
    const rest = allGroups
      .filter((g) => !takenFavs.has(g))
      .sort((a, b) => Number(!!soldCheck(b, linkChecks)) - Number(!!soldCheck(a, linkChecks)));
    return { dropoutItems: items, groups: rest };
  }, [allGroups, dropouts, rankedLinks, linkChecks, marketByLink]);

  const rankedCount = groupDuplicates(listings ?? []).length - allGroups.length;
  const goneCount = groups.filter((g) => isGroupGone(g, scrape)).length;
  const dropCount = groups.filter((g) => (priceChange(g.primary)?.delta ?? 0) < 0).length;
  const soldCount = groups.filter((g) => soldCheck(g, linkChecks)).length;

  /**
   * Removing a favorite hides the car (it doesn't drop back into Results) - once
   * you've looked at a car closely enough to favorite and then drop it, you're
   * done with it. For a drop-out, its drop-out record goes too. Undo restores
   * both; Settings → Hidden listings can restore the car later.
   */
  async function handleRemove(group: ListingGroup | undefined, dropout?: RankDropoutRow) {
    const keys = new Set(group?.keys ?? []);
    const members = group ? [group.primary, ...group.others] : [];
    const index = listings?.findIndex((l) => keys.has(l.unique_key)) ?? 0;
    const restore = () =>
      setListings((prev) => {
        if (!prev || !members.length || prev.some((l) => keys.has(l.unique_key))) return prev;
        const next = [...prev];
        next.splice(Math.max(0, index), 0, ...members);
        return next;
      });

    setListings((prev) => prev?.filter((l) => !keys.has(l.unique_key)) ?? prev);
    try {
      // Undo restores exactly what was there (a drop-out needn't have been a favorite).
      const snapshot = await snapshotStatuses(group?.keys ?? []);
      if (group) await setListingStatus(group.keys, "disliked");
      if (dropout) {
        await deleteDropouts([dropout.id]);
        await onDropoutsChanged();
      }
      notify(group ? "Removed from Favorites and hidden" : "Removed", {
        onUndo: async () => {
          restore();
          try {
            await restoreStatuses(snapshot);
            if (dropout) {
              await restoreDropouts([dropout]);
              await onDropoutsChanged();
            }
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

  async function copy(what: "dropouts" | "favorites" | "all") {
    const parts = [
      what !== "favorites" && dropoutItems.length ? dropoutsAsText(dropoutItems, linkChecks) : null,
      what !== "dropouts" && groups.length ? favoritesAsText(groups, linkChecks) : null,
    ].filter(Boolean);
    const label = what === "all" ? "Everything" : what === "dropouts" ? "Dropped cars" : "Favorites";
    const ok = parts.length > 0 && (await copyText(parts.join("\n\n")));
    notify(ok ? `${label} copied — paste it into WhatsApp` : "Couldn't copy — your browser blocked clipboard access", {
      tone: ok ? "info" : "error",
    });
  }

  function actionsFor(group: ListingGroup, dropout?: RankDropoutRow) {
    const sold = soldCheck(group, linkChecks);
    return (
      <>
        <button
          className={`${ghostButtonClass} ${sold ? "!text-red-600 dark:!text-red-400" : "hover:!text-red-600"}`}
          onClick={() => handleRemove(group, dropout)}
          title="Remove from Favorites and hide it (undo available; restore later from Settings)"
        >
          <TrashIcon /> Remove
        </button>
        {!sold && (
          <button
            className={`${ghostButtonClass} hover:!text-orange-600`}
            onClick={() => onRank(dropout ? candidateFromDropout(dropout, group) : candidateFromGroup(group))}
            title="Rank it - choose the list and position (30 days)"
          >
            <TrophyIcon /> {dropout ? "Rank again" : "Rank"}
          </button>
        )}
      </>
    );
  }

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (listings === null) return <CardGridSkeleton count={3} />;
  if (groups.length === 0 && dropoutItems.length === 0) {
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
    <div className="space-y-8">
      {dropoutItems.length > 0 && groups.length > 0 && (
        <div className="-mb-4 flex justify-end">
          <button className={secondaryButtonClass} onClick={() => copy("all")} title="Dropped cars and favorites in one message">
            <CopyIcon /> Copy all
          </button>
        </div>
      )}
      {dropoutItems.length > 0 && (
        <section>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-baseline gap-2 text-lg font-bold tracking-tight">
                Dropped from ranking
                <span className="text-sm font-medium tabular-nums text-neutral-400">{dropoutItems.length}</span>
              </h2>
              <p className="text-sm text-neutral-500">Pushed out of a full rank list. Rank again, or remove.</p>
            </div>
            <button className={`${ghostButtonClass} shrink-0`} onClick={() => copy("dropouts")}>
              <CopyIcon /> Copy
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dropoutItems.map(({ row, group }) => {
              const note = `Dropped from ${row.list}${row.rank ? ` (#${row.rank})` : ""} · ${timeAgo(row.dropped_at)}`;
              return group ? (
                <ListingCard
                  key={row.id}
                  group={group}
                  isNew={false}
                  deal={deals.get(group.primary.unique_key)}
                  gone={isGroupGone(group, scrape)}
                  sold={soldCheck(group, linkChecks)}
                  note={note}
                  actions={actionsFor(group, row)}
                />
              ) : (
                <UntrackedDropout
                  key={row.id}
                  row={row}
                  note={note}
                  sold={row.link ? linkChecks.get(normLink(row.link)) : undefined}
                  onRemove={() => handleRemove(undefined, row)}
                  onRankAgain={() => onRank(candidateFromDropout(row, undefined))}
                />
              );
            })}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            {dropoutItems.length > 0 && <h2 className="text-lg font-bold tracking-tight">Favorites</h2>}
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
                <span className="font-medium text-amber-600 dark:text-amber-400">
                  {goneCount} not seen lately — may be sold
                </span>
              )}
            </p>
          </div>
          {groups.length > 0 && (
            <button className={`${ghostButtonClass} shrink-0`} onClick={() => copy("favorites")}>
              <CopyIcon /> Copy
            </button>
          )}
        </div>
        {groups.length === 0 ? (
          <p className="text-sm text-neutral-500">No other favorites.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => (
              <ListingCard
                key={group.primary.unique_key}
                group={group}
                isNew={false}
                deal={deals.get(group.primary.unique_key)}
                gone={isGroupGone(group, scrape)}
                sold={soldCheck(group, linkChecks)}
                actions={actionsFor(group)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** A dropped car MotoHunt doesn't scrape (e.g. a CarSwitch ad from the chat): shown from the saved rank details. */
function UntrackedDropout({
  row,
  note,
  sold,
  onRemove,
  onRankAgain,
}: {
  row: RankDropoutRow;
  note: string;
  sold: LinkCheckRow | undefined;
  onRemove: () => void;
  onRankAgain: () => void;
}) {
  const gone = sold?.status === "gone" ? sold : undefined;
  return (
    <article className={`${panelClass} flex flex-col ${gone ? "!border-red-300 dark:!border-red-900" : ""}`}>
      <div className={`flex flex-1 flex-col gap-2 p-4 ${gone ? "opacity-60" : ""}`}>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-semibold uppercase tracking-wider text-neutral-500">
            {row.link ? hostOf(row.link) : "no ad link"}
          </span>
          {gone && <SoldTag check={gone} />}
        </div>
        <h3 className="font-semibold leading-snug">{row.title ?? "Car"}</h3>
        <p className="text-sm tabular-nums">
          <span className="font-bold">{row.price == null ? "Price on request" : `AED ${formatNumber(row.price)}`}</span>
          {row.km != null && <span className="text-neutral-500"> · {formatNumber(row.km)} km</span>}
        </p>
        <p className="text-xs font-medium text-orange-700 dark:text-orange-400">{note}</p>
        {row.note && <p className="text-sm text-neutral-500">{row.note}</p>}
        <p className="text-xs text-neutral-400">Not scraped by MotoHunt — shown from the details saved with its rank.</p>
      </div>
      <div className="flex items-center gap-1 border-t border-neutral-100 px-2 py-1.5 dark:border-neutral-800">
        <button className={`${ghostButtonClass} hover:!text-red-600`} onClick={onRemove}>
          <TrashIcon /> Remove
        </button>
        {!gone && (
          <button className={`${ghostButtonClass} hover:!text-orange-600`} onClick={onRankAgain}>
            <TrophyIcon /> Rank again
          </button>
        )}
        {row.link && (
          <a href={row.link} target="_blank" rel="noreferrer" className={`${ghostButtonClass} ml-auto text-neutral-900 dark:text-neutral-100`}>
            View ad <ExternalIcon />
          </a>
        )}
      </div>
    </article>
  );
}
