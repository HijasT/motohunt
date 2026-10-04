"use client";

import { useMemo } from "react";
import type { ListingRow } from "../../lib/supabase/types";
import { scoreListing, type Basis } from "../../lib/scoring";

const BASIS_LABEL: Record<Basis, string> = {
  auto: "from listing data",
  text: "read from the ad text",
  estimated: "estimated from platform knowledge",
  manual: "not in the data — your judgment",
};
const BASIS_DOT: Record<Basis, string> = {
  auto: "bg-emerald-500",
  text: "bg-sky-500",
  estimated: "bg-amber-500",
  manual: "bg-neutral-400",
};

function toneFor(total: number): string {
  if (total >= 38) return "bg-emerald-600 text-white";
  if (total >= 30) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  if (total >= 22) return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  return "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400";
}

/** Rubric score (0-50) with a collapsible per-criterion breakdown. Each criterion's colored dot shows its basis. */
export function ScoreBadge({ listing }: { listing: ListingRow }) {
  const s = useMemo(() => scoreListing(listing), [listing]);

  return (
    <details className="text-left">
      <summary className="flex cursor-pointer list-none items-center gap-1.5">
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${toneFor(s.total)}`}>
          Score {s.total}/50
        </span>
        {!s.eligible && (
          <span
            title={s.excludeReasons.join("; ")}
            className="rounded-md bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            Ineligible
          </span>
        )}
        {s.eligible && s.budgetEligible && (
          <span
            title="Under 225,000 km and AED 23,000 or less"
            className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300"
          >
            Budget list
          </span>
        )}
        {s.eligible && !s.budgetEligible && s.overCaps && (
          <span
            title={`${s.overCapReasons.join("; ")} — and not budget-eligible (needs < 225,000 km and ≤ AED 23,000)`}
            className="rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            No list
          </span>
        )}
      </summary>
      <div className="mt-2 rounded-lg border border-neutral-200 bg-white p-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
        {!s.eligible && (
          <p className="mb-1.5 font-medium text-red-600 dark:text-red-400">Excluded: {s.excludeReasons.join("; ")}</p>
        )}
        {s.eligible && s.overCaps && (
          <p className="mb-1.5 font-medium text-amber-600 dark:text-amber-400">
            {s.overCapReasons.join("; ")} — barred from the general lists
          </p>
        )}
        {s.eligible && s.budgetEligible && (
          <p className="mb-1.5 font-medium text-amber-600 dark:text-amber-400">
            High-Mileage/Budget list: under 225,000 km and AED 23,000 or less
          </p>
        )}
        <table className="w-full border-collapse">
          <tbody>
            {s.criteria.map((c) => (
              <tr key={c.n} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
                <td className="py-0.5 pr-2 text-neutral-400 tabular-nums">{c.n}</td>
                <td className="py-0.5 pr-2">
                  {c.label}
                  {c.note && <span className="text-neutral-400"> · {c.note}</span>}
                </td>
                <td className="py-0.5 pr-2 text-right font-semibold tabular-nums">
                  {c.score}/{c.max}
                </td>
                <td className="py-0.5">
                  <span
                    title={BASIS_LABEL[c.basis]}
                    className={`inline-block h-2 w-2 rounded-full ${BASIS_DOT[c.basis]}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {s.accident && (
          <p className="mt-1.5 text-neutral-500">
            Accident:{" "}
            <span
              className={
                s.accident === "reported"
                  ? "font-medium text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }
            >
              {s.accident}
            </span>{" "}
            — apply the penalty manually
          </p>
        )}
        <p className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-neutral-400">
          {(["auto", "text", "estimated", "manual"] as Basis[]).map((b) => (
            <span key={b} className="flex items-center gap-1">
              <span className={`inline-block h-2 w-2 rounded-full ${BASIS_DOT[b]}`} />
              {BASIS_LABEL[b]}
            </span>
          ))}
        </p>
      </div>
    </details>
  );
}
