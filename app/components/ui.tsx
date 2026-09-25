"use client";

// Shared styling tokens and tiny building blocks used across the tabs.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { UndoIcon, XIcon } from "./icons";

// ---- Class tokens -------------------------------------------------------------

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-950";

export const primaryButtonClass = `inline-flex items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 ${focusRing}`;

export const secondaryButtonClass = `inline-flex items-center justify-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 ${focusRing}`;

export const ghostButtonClass = `inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 ${focusRing}`;

export const inputClass = `w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 transition focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/30 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500`;

export const panelClass =
  "rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900";

export { focusRing };

// ---- Formatting -----------------------------------------------------------------

export function formatNumber(n: number | null): string {
  return n === null ? "—" : n.toLocaleString("en-US");
}

/** "just now", "3h ago", "5d ago" - coarse on purpose, cards only need a feel for freshness. */
export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String(e.message) : String(e);
}

// ---- Persisted UI state ------------------------------------------------------------

/**
 * useState that remembers its value in localStorage. Reads after mount (not in the
 * initializer) so server and first client render agree; storage failures (private
 * mode, blocked storage) silently fall back to plain in-memory state.
 */
export function usePersistentState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      /* ignore */
    }
  }, [key]);

  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [key]
  );

  return [value, set];
}

// ---- Feedback ------------------------------------------------------------------------

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
      {children}
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 px-6 py-14 text-center dark:border-neutral-700">
      <p className="font-medium text-neutral-800 dark:text-neutral-200">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-neutral-500">{children}</div>}
    </div>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading listings">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`${panelClass} animate-pulse space-y-3 p-4`}>
          <div className="h-3 w-24 rounded bg-neutral-200 dark:bg-neutral-800" />
          <div className="h-5 w-3/4 rounded bg-neutral-200 dark:bg-neutral-800" />
          <div className="h-7 w-1/3 rounded bg-neutral-200 dark:bg-neutral-800" />
          <div className="h-3 w-full rounded bg-neutral-100 dark:bg-neutral-800/60" />
          <div className="h-8 w-full rounded bg-neutral-100 dark:bg-neutral-800/60" />
        </div>
      ))}
    </div>
  );
}

// ---- Toasts --------------------------------------------------------------------------

/** An optional extra button on a toast, e.g. "View in Results". */
type ToastAction = { label: string; onClick: () => void };
type Toast = { id: number; message: string; tone: "info" | "error"; onUndo?: () => void; action?: ToastAction };
type ToastApi = {
  notify: (message: string, opts?: { onUndo?: () => void; action?: ToastAction; tone?: Toast["tone"] }) => void;
};

const ToastContext = createContext<ToastApi>({ notify: () => {} });

export const useToast = () => useContext(ToastContext);

const TOAST_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const notify = useCallback<ToastApi["notify"]>(
    (message, opts) => {
      const id = ++nextId.current;
      // Keep at most 3 on screen; the newest is the one the user is looking for.
      setToasts((prev) => [
        ...prev.slice(-2),
        { id, message, tone: opts?.tone ?? "info", onUndo: opts?.onUndo, action: opts?.action },
      ]);
      window.setTimeout(() => dismiss(id), TOAST_MS);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ring-1 ${
              t.tone === "error"
                ? "bg-red-600 text-white ring-red-700"
                : "bg-neutral-900 text-white ring-black/10 dark:bg-neutral-100 dark:text-neutral-900"
            }`}
          >
            <span className="flex-1">{t.message}</span>
            {t.action && (
              <button
                className="font-semibold text-orange-400 hover:text-orange-300 dark:text-orange-600 dark:hover:text-orange-700"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            {t.onUndo && (
              <button
                className="inline-flex items-center gap-1 font-semibold text-orange-400 hover:text-orange-300 dark:text-orange-600 dark:hover:text-orange-700"
                onClick={() => {
                  t.onUndo?.();
                  dismiss(t.id);
                }}
              >
                <UndoIcon /> Undo
              </button>
            )}
            <button className="opacity-60 hover:opacity-100" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <XIcon />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---- Clipboard --------------------------------------------------------------------------

/** Copies text; falls back to a hidden textarea where the async Clipboard API isn't allowed. Returns success. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      el.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
