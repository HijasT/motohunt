"use client";

import { useEffect, useMemo, useState } from "react";
import type { LinkCheckRow, ListingRow, RankingRow, ScrapeStatus } from "../../lib/supabase/types";
import {
  removeRanking,
  restoreRanking,
  restoreStatuses,
  setListingStatus,
  setRankOrder,
  snapshotStatuses,
} from "../../lib/supabase/queries";
import {
  groupDuplicates,
  isGroupGone,
  normLink,
  priceChange,
  type Deal,
  type ListingGroup,
} from "../../lib/listingInsights";
import { DealChip, SoldTag } from "./ListingCard";
import { CopyIcon, ExternalIcon, HeartIcon, TrashIcon } from "./icons";
import {
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

/** The main list - the default choice in the rank dialog. */
export const GENERAL_LIST = "General";
/** Known lists render in this order; any other list name follows, alphabetically. */
export const LIST_ORDER = [GENERAL_LIST, "Above-Budget", "High-Mileage/Budget", "Dodge"];
/** The ranking chat keeps a top 8 in General and treats 9+ as reserve. */
const GENERAL_TOP = 8;

type Props = {
  rankings: RankingRow[];
  /** Load error for the rankings table (e.g. migration not applied yet). */
  error: string | null;
  market: ListingRow[];
  deals: Map<string, Deal>;
  scrape: ScrapeStatus | null;
  /** Latest link-check result per normLink key. */
  linkChecks: Map<string, LinkCheckRow>;
  onChanged: () => Promise<void>;
};

const DAY_MS = 86_400_000;

function daysLeft(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / DAY_MS));
}

function hostOf(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return link;
  }
}

function listOrder(a: string, b: string): number {
  const ia = LIST_ORDER.indexOf(a);
  const ib = LIST_ORDER.indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  return a.localeCompare(b);
}

const slug = (list: string) => `rank-${list.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/** Everything a row shows, resolved once so the card and the copied text agree. */
type Resolved = {
  row: RankingRow;
  group: ListingGroup | undefined;
  /** The exact scraped ad that was ranked (most recently seen copy), if MotoHunt tracks it. */
  shown: ListingRow | undefined;
  title: string;
  price: number | null;
  km: number | null;
  sold: LinkCheckRow | undefined;
};

function resolve(row: RankingRow, groupByLink: Map<string, ListingGroup>, linkChecks: Map<string, LinkCheckRow>): Resolved {
  const key = row.link ? normLink(row.link) : null;
  const group = key ? groupByLink.get(key) : undefined;
  const shown = group
    ? [group.primary, ...group.others]
        .filter((l) => normLink(l.link) === key)
        .sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at))[0]
    : undefined;
  const check = key ? linkChecks.get(key) : undefined;
  return {
    row,
    group,
    shown,
    title: row.title || (shown ? `${shown.year ?? ""} ${shown.make} ${shown.model}`.trim() : hostOf(row.link ?? "")),
    // Live scraped numbers win over the ones saved with the rank (the price may have moved since).
    price: shown?.price ?? row.price,
    km: shown?.km ?? row.km,
    sold: check?.status === "gone" ? check : undefined,
  };
}

/** WhatsApp-friendly: *bold* list names, one car per line, its link underneath. */
function listAsText(list: string, items: Resolved[]): string {
  const lines = [`*${list}*`];
  items.forEach((r, i) => {
    const facts = [r.price == null ? null : `AED ${formatNumber(r.price)}`, r.km == null ? null : `${formatNumber(r.km)} km`]
      .filter(Boolean)
      .join(" · ");
    lines.push(`${i + 1}. ${r.title}${facts ? ` — ${facts}` : ""}${r.sold ? " (SOLD)" : ""}`);
    lines.push(r.row.link ?? "(no link)");
  });
  return lines.join("\n");
}

export function RankTab({ rankings, error, market, deals, scrape, linkChecks, onChanged }: Props) {
  const { notify } = useToast();
  // Local copy so reorders are instant; resynced whenever the parent refetches.
  const [rows, setRows] = useState(rankings);
  useEffect(() => setRows(rankings), [rankings]);

  const groupByLink = useMemo(() => {
    const map = new Map<string, ListingGroup>();
    for (const g of groupDuplicates(market)) {
      for (const l of [g.primary, ...g.others]) map.set(normLink(l.link), g);
    }
    return map;
  }, [market]);

  // rows arrive sorted by rank, so each list's slice is already in order.
  const lists = useMemo(() => {
    const byList = new Map<string, Resolved[]>();
    for (const r of rows) byList.set(r.list, [...(byList.get(r.list) ?? []), resolve(r, groupByLink, linkChecks)]);
    return [...byList.entries()].sort(([a], [b]) => listOrder(a, b));
  }, [rows, groupByLink, linkChecks]);

  const soldCount = lists.reduce((n, [, items]) => n + items.filter((r) => r.sold).length, 0);
  const lastCheck = [...linkChecks.values()].reduce<string | null>(
    (latest, c) => (!latest || c.checked_at > latest ? c.checked_at : latest),
    null
  );

  /** Replaces one list's rows (keeping the others) and persists its new order. */
  async function saveOrder(list: string, next: RankingRow[]) {
    const before = rows;
    setRows([...rows.filter((r) => r.list !== list), ...next.map((r, i) => ({ ...r, rank: i + 1 }))]);
    try {
      await setRankOrder(next);
      await onChanged();
    } catch (e) {
      setRows(before);
      notify(`Couldn't reorder: ${errorMessage(e)}`, { tone: "error" });
    }
  }

  function move(list: string, items: Resolved[], index: number, delta: -1 | 1) {
    const next = items.map((r) => r.row);
    const [row] = next.splice(index, 1);
    next.splice(index + delta, 0, row);
    void saveOrder(list, next);
  }

  /**
   * Takes a car off its list. "favorite": it lands in Favorites (even if it was
   * ranked straight from the chat and never favorited). "remove": it's hidden
   * for good, so it doesn't drift back into Favorites or Results. Both undoable.
   */
  async function takeOff(list: string, items: Resolved[], target: Resolved, mode: "favorite" | "remove") {
    const keys = target.group?.keys ?? [];
    const position = items.findIndex((r) => r.row.id === target.row.id);
    const remaining = items.filter((r) => r.row.id !== target.row.id).map((r) => r.row);
    const before = rows;
    setRows([...rows.filter((r) => r.list !== list), ...remaining.map((r, i) => ({ ...r, rank: i + 1 }))]);
    let snapshot: Awaited<ReturnType<typeof snapshotStatuses>> | undefined;
    try {
      snapshot = await snapshotStatuses(keys);
      if (keys.length) await setListingStatus(keys, mode === "favorite" ? "favorited" : "disliked");
      await removeRanking(target.row.id);
      await setRankOrder(remaining); // close the gap: 1,2,4 -> 1,2,3
      await onChanged();
      notify(mode === "favorite" ? `Moved to Favorites` : `Removed “${target.title}”`, {
        onUndo: async () => {
          try {
            if (snapshot) await restoreStatuses(snapshot);
            await restoreRanking(target.row);
            // Put it back in its old slot: everything below it shifts down by one.
            const restored = [...remaining];
            restored.splice(position, 0, target.row);
            await setRankOrder(restored);
            await onChanged();
          } catch (e) {
            notify(`Couldn't undo: ${errorMessage(e)}`, { tone: "error" });
          }
        },
      });
    } catch (e) {
      setRows(before);
      // Don't leave a half-done action: put favorite/hidden status back too.
      if (snapshot) await restoreStatuses(snapshot).catch(() => {});
      notify(`Couldn't update ranking: ${errorMessage(e)}`, { tone: "error" });
    }
  }

  async function copy(text: string, what: string) {
    const ok = await copyText(text);
    notify(ok ? `${what} copied — paste it into WhatsApp` : "Couldn't copy — your browser blocked clipboard access", {
      tone: ok ? "info" : "error",
    });
  }

  if (error) {
    return (
      <ErrorNote>
        Couldn&apos;t load rankings: {error}. If the table doesn&apos;t exist yet, apply the rankings migrations in
        supabase/migrations/.
      </ErrorNote>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState title="Nothing ranked yet">
        Use <span className="font-medium text-neutral-700 dark:text-neutral-300">Rank</span> on a card in Favorites to
        add it here. Each car stays ranked for 30 days, then goes back to Favorites.
      </EmptyState>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="text-sm text-neutral-500">
          <p>Best first in each list. Ranked cars are hidden from Favorites and Results; each rank lasts 30 days.</p>
          <p className="mt-0.5">
            {lastCheck ? (
              <>
                Ad links checked {timeAgo(lastCheck)}
                {soldCount > 0 && (
                  <span className="font-semibold text-red-600 dark:text-red-400">
                    {" "}
                    · {soldCount} sold or removed — review and remove {soldCount === 1 ? "it" : "them"}
                  </span>
                )}
              </>
            ) : (
              "Ad links haven't been checked yet — the check runs daily (GitHub Actions → “Check ad links”)."
            )}
          </p>
        </div>
        <button
          className={secondaryButtonClass}
          onClick={() => copy(lists.map(([list, items]) => listAsText(list, items)).join("\n\n"), "All lists")}
        >
          <CopyIcon /> Copy all lists
        </button>
      </div>

      {lists.length > 1 && (
        <nav className="mb-5 flex flex-wrap gap-2" aria-label="Rank lists">
          {lists.map(([list, items]) => (
            <a
              key={list}
              href={`#${slug(list)}`}
              className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {list} <span className="tabular-nums text-neutral-400">{items.length}</span>
            </a>
          ))}
        </nav>
      )}

      <div className="space-y-8">
        {lists.map(([list, items]) => (
          <section key={list} id={slug(list)} className="scroll-mt-20">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="flex items-baseline gap-2 text-lg font-bold tracking-tight">
                {list}
                <span className="text-sm font-medium tabular-nums text-neutral-400">{items.length}</span>
              </h2>
              <button className={ghostButtonClass} onClick={() => copy(listAsText(list, items), list)}>
                <CopyIcon /> Copy
              </button>
            </div>
            <ol className="space-y-3">
              {items.map((r, i) => (
                <RankRow
                  key={r.row.id}
                  r={r}
                  position={i + 1}
                  isFirst={i === 0}
                  isLast={i === items.length - 1}
                  reserveStartsHere={list === GENERAL_LIST && i === GENERAL_TOP}
                  deals={deals}
                  scrape={scrape}
                  onUp={() => move(list, items, i, -1)}
                  onDown={() => move(list, items, i, 1)}
                  onToFavorites={() => takeOff(list, items, r, "favorite")}
                  onRemove={() => takeOff(list, items, r, "remove")}
                />
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

type RowProps = {
  r: Resolved;
  position: number;
  isFirst: boolean;
  isLast: boolean;
  reserveStartsHere: boolean;
  deals: Map<string, Deal>;
  scrape: ScrapeStatus | null;
  onUp: () => void;
  onDown: () => void;
  onToFavorites: () => void;
  onRemove: () => void;
};

const iconButton = `${ghostButtonClass} px-2 disabled:opacity-30`;

function RankRow({ r, position, isFirst, isLast, reserveStartsHere, deals, scrape, onUp, onDown, onToFavorites, onRemove }: RowProps) {
  const { row, group, shown, title, price, km, sold } = r;
  const change = shown ? priceChange(shown) : null;
  const deal = shown ? deals.get(shown.unique_key) : undefined;
  const notSeen = !sold && group ? isGroupGone(group, scrape) : false;
  const left = daysLeft(row.expires_at);

  return (
    <>
      {reserveStartsHere && (
        <li className="flex items-center gap-3 pt-2 text-xs font-semibold uppercase tracking-wider text-neutral-400" aria-hidden>
          <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
          Reserve
          <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
        </li>
      )}
      <li className={`${panelClass} overflow-hidden ${sold ? "border-red-300 dark:border-red-900" : ""}`}>
        <div className="flex items-stretch gap-3 p-3 sm:gap-4 sm:p-4">
          <div
            className={`flex w-10 shrink-0 items-center justify-center rounded-lg text-lg font-bold tabular-nums sm:w-12 sm:text-xl ${
              isFirst ? "bg-orange-500 text-white" : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            }`}
          >
            {position}
          </div>

          <div className={`min-w-0 flex-1 ${sold ? "opacity-70" : ""}`}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              {row.link ? (
                <a href={row.link} target="_blank" rel="noreferrer" className="break-words font-semibold hover:underline">
                  {title}
                </a>
              ) : (
                <span className="break-words font-semibold">{title}</span>
              )}
              <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                {shown?.source ?? (row.link ? hostOf(row.link) : "no ad link")}
              </span>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums">
              <span className="font-bold">{price == null ? "Price on request" : `AED ${formatNumber(price)}`}</span>
              {change && change.delta < 0 && (
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">↓ {formatNumber(-change.delta)}</span>
              )}
              {km != null && <span className="text-neutral-500">{formatNumber(km)} km</span>}
              {deal && deal.label !== "fair" && shown && <DealChip deal={deal} listing={shown} />}
              {sold && <SoldTag check={sold} />}
              {notSeen && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  Not seen lately
                </span>
              )}
            </div>

            {row.note && <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">{row.note}</p>}

            <p
              className={`mt-1.5 text-xs ${left <= 5 ? "font-medium text-amber-600 dark:text-amber-400" : "text-neutral-400"}`}
              title={`Ranked ${new Date(row.ranked_at).toLocaleDateString()}, expires ${new Date(row.expires_at).toLocaleDateString()}`}
            >
              {left === 0 ? "Expires today" : `Expires in ${left} day${left === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 border-t border-neutral-100 px-2 py-1.5 dark:border-neutral-800">
          <button className={iconButton} disabled={isFirst} onClick={onUp} aria-label="Move up">
            ↑
          </button>
          <button className={iconButton} disabled={isLast} onClick={onDown} aria-label="Move down">
            ↓
          </button>
          <button
            className={`${ghostButtonClass} hover:!text-rose-600 disabled:cursor-not-allowed disabled:opacity-40`}
            onClick={onToFavorites}
            disabled={!group}
            title={group ? "Unrank and keep it in Favorites" : "Not tracked by MotoHunt, so it can't be a favorite — use Remove"}
          >
            <HeartIcon /> <span className="hidden min-[380px]:inline">To favorites</span>
          </button>
          <button
            className={`${ghostButtonClass} ${sold ? "!text-red-600 dark:!text-red-400" : "hover:!text-red-600"}`}
            onClick={onRemove}
            title="Remove from the ranking and hide it everywhere (undo available)"
          >
            <TrashIcon /> Remove
          </button>
          {row.link && (
            <a href={row.link} target="_blank" rel="noreferrer" className={`${ghostButtonClass} ml-auto`}>
              <span className="hidden sm:inline">View ad</span> <ExternalIcon />
            </a>
          )}
        </div>
      </li>
    </>
  );
}
