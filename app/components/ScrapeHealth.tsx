"use client";

import type { ScrapeStatus } from "../../lib/supabase/types";
import { AlertIcon } from "./icons";
import { formatNumber, timeAgo } from "./ui";

/** Cron is every 6h; GitHub often starts scheduled runs late, so allow some slack before warning. */
const STALE_AFTER_MS = 9 * 60 * 60 * 1000;

type Health = { tone: "ok" | "warn" | "error" | "unknown"; label: string; detail: string };

export function scrapeHealth(scrape: ScrapeStatus | null): Health {
  if (!scrape) {
    return {
      tone: "unknown",
      label: "No scrape recorded",
      detail: "Status appears after the next scheduled run of the updated scraper.",
    };
  }
  const ago = timeAgo(scrape.at);
  const failedSources = scrape.sources.filter((s) => s.failedSearches > 0).map((s) => s.name);
  const sourceNote = failedSources.length > 0 ? ` ${failedSources.join(", ")} failed.` : "";

  if (!scrape.ok) {
    return { tone: "error", label: `Scrape failed ${ago}`, detail: `${scrape.error ?? "The last run failed."}${sourceNote}` };
  }
  if (Date.now() - new Date(scrape.at).getTime() > STALE_AFTER_MS) {
    return {
      tone: "warn",
      label: `Last updated ${ago}`,
      detail: `No scrape has finished for a while — check the GitHub Actions tab.${sourceNote}`,
    };
  }
  return { tone: "ok", label: `Updated ${ago}`, detail: `Last run found ${formatNumber(scrape.written)} listings.${sourceNote}` };
}

const DOT = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  error: "bg-red-500",
  unknown: "bg-neutral-400",
};

/** Compact header indicator. Always visible when something's wrong; on phones hidden when healthy to save room. */
export function ScrapeStatusPill({ scrape, onClick }: { scrape: ScrapeStatus | null; onClick: () => void }) {
  const h = scrapeHealth(scrape);
  const problem = h.tone === "warn" || h.tone === "error";
  return (
    <button
      onClick={onClick}
      title={h.detail}
      className={`items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition ${
        problem
          ? "flex bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-300"
          : "hidden text-neutral-500 hover:bg-neutral-100 sm:flex dark:hover:bg-neutral-800"
      }`}
    >
      {problem ? <AlertIcon className="h-3.5 w-3.5" /> : <span className={`h-2 w-2 rounded-full ${DOT[h.tone]}`} />}
      <span className={problem ? "hidden sm:inline" : ""}>{h.label}</span>
    </button>
  );
}

export function ScrapeHealth({ scrape }: { scrape: ScrapeStatus | null }) {
  const h = scrapeHealth(scrape);
  return (
    <div>
      <div className="flex items-start gap-3 px-4 py-3">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[h.tone]}`} />
        <div className="min-w-0">
          <p className="font-medium">{h.label}</p>
          <p className="text-sm text-neutral-500">
            {h.detail}
            {scrape && (
              <>
                {" "}
                {new Date(scrape.at).toLocaleString()} · {scrape.searches} search{scrape.searches === 1 ? "" : "es"} ·{" "}
                {Math.round(scrape.durationMs / 60000)} min
                {scrape.failed > 0 && ` · ${scrape.failed} failed to save`}
              </>
            )}
          </p>
        </div>
      </div>
      {scrape && scrape.sources.length > 0 && (
        <ul className="grid gap-px border-t border-neutral-100 bg-neutral-100 sm:grid-cols-2 lg:grid-cols-5 dark:border-neutral-800 dark:bg-neutral-800">
          {scrape.sources.map((s) => (
            <li key={s.name} className="bg-white px-4 py-3 dark:bg-neutral-900">
              <p className="flex items-center gap-2 text-sm font-medium">
                <span className={`h-2 w-2 rounded-full ${s.failedSearches > 0 ? "bg-red-500" : "bg-emerald-500"}`} />
                {s.name}
              </p>
              <p className="text-sm tabular-nums text-neutral-500">
                {formatNumber(s.listings)} listing{s.listings === 1 ? "" : "s"}
                {s.failedSearches > 0 && (
                  <span className="text-red-600 dark:text-red-400"> · failed {s.failedSearches}×</span>
                )}
              </p>
              {s.error && (
                <p className="mt-0.5 line-clamp-2 text-xs text-neutral-400" title={s.error}>
                  {s.error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
