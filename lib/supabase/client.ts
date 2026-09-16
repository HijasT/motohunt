// Frontend-only: the browser/anon Supabase client. Single-user app with no login
// (see DESIGN.md Auth section) - protect the deployed site itself (Vercel
// password protection or similar), not with per-row auth here.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Lazily constructed so importing this module never throws - only calling it
 * without the env vars set does. That matters because Next.js still executes
 * client-component module code once during `next build`'s static render pass;
 * a top-level `createClient()` call would fail that build in an environment
 * with no Supabase project configured yet.
 */
export function getSupabaseClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY - set them in .env.local (see .env.example)."
    );
  }

  cached = createClient(url, key);
  return cached;
}
