// Scraper-only: the service-role Supabase client. This bypasses RLS entirely, so
// it must never be imported from anything under app/ - only from index.ts and
// lib/supabaseWriter.ts, which run as a Node/tsx script (GitHub Actions), never
// bundled into the Next.js app.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY environment variables.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
