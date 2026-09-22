// Frontend-only: every Supabase read/write the app/ components make. Deliberately
// plain functions (no React hooks) so components stay in charge of loading state
// and error handling; see app/components/*.tsx for how they're used.
import { getSupabaseClient } from "./client";
import type {
  AppStateValue,
  ListingRow,
  SavedSearchRow,
  ScrapeStatus,
  SearchGroupRow,
} from "./types";

// ---- Results -----------------------------------------------------------

/** Characters that would break the hand-built PostgREST filter string below. */
function sanitizeForFilter(value: string): string {
  return value.replace(/[,()%*]/g, " ").trim();
}

/**
 * One saved search becomes one `and(...)` clause; `fetchResults` OR's them
 * together. A search with no criteria at all is skipped rather than emitted as
 * an empty `and()`, which PostgREST rejects.
 */
function clauseForSearch(s: SavedSearchRow): string | null {
  const parts: string[] = [];
  if (s.make) parts.push(`make.ilike.%${sanitizeForFilter(s.make)}%`);
  if (s.model) parts.push(`model.ilike.%${sanitizeForFilter(s.model)}%`);
  if (s.year_from != null) parts.push(`year.gte.${s.year_from}`);
  if (s.year_to != null) parts.push(`year.lte.${s.year_to}`);
  if (s.price_from != null) parts.push(`price.gte.${s.price_from}`);
  if (s.price_to != null) parts.push(`price.lte.${s.price_to}`);
  if (s.km_from != null) parts.push(`km.gte.${s.km_from}`);
  if (s.km_to != null) parts.push(`km.lte.${s.km_to}`);
  return parts.length > 0 ? `and(${parts.join(",")})` : null;
}

/**
 * Results tab: every non-expired listing that isn't favorited or disliked,
 * further narrowed to whichever saved searches are currently selected (OR'd -
 * an empty selection means "show everything", not "show nothing").
 */
export async function fetchResults(selectedSearches: SavedSearchRow[]): Promise<ListingRow[]> {
  const supabase = getSupabaseClient();

  const excludedKeys = await fetchStatusedKeys();

  let query = supabase
    .from("listings")
    .select("*")
    .gt("expires_at", new Date().toISOString())
    .order("first_seen_at", { ascending: false });

  const clauses = selectedSearches.map(clauseForSearch).filter((c): c is string => c !== null);
  if (clauses.length > 0) query = query.or(clauses.join(","));

  if (excludedKeys.length > 0) {
    query = query.not("unique_key", "in", `(${excludedKeys.join(",")})`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function fetchStatusedKeys(): Promise<string[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("listing_status").select("listing_unique_key");
  if (error) throw error;
  return (data ?? []).map((r) => r.listing_unique_key);
}

async function fetchListingsByStatus(status: "favorited" | "disliked"): Promise<ListingRow[]> {
  const supabase = getSupabaseClient();

  const { data: statuses, error: statusError } = await supabase
    .from("listing_status")
    .select("listing_unique_key")
    .eq("status", status)
    .order("created_at", { ascending: false });
  if (statusError) throw statusError;

  const keys = (statuses ?? []).map((s) => s.listing_unique_key);
  if (keys.length === 0) return [];

  const { data, error } = await supabase.from("listings").select("*").in("unique_key", keys);
  if (error) throw error;

  // `.in()` doesn't preserve order; re-sort to match the status list's own order.
  const order = new Map(keys.map((k, i) => [k, i]));
  return (data ?? []).sort((a, b) => (order.get(a.unique_key) ?? 0) - (order.get(b.unique_key) ?? 0));
}

export const fetchFavorites = () => fetchListingsByStatus("favorited");
export const fetchDisliked = () => fetchListingsByStatus("disliked");

/**
 * Takes several keys because duplicate listings of one car (same car on two
 * sites, or a repost) are shown as a single card and triaged together.
 */
export async function setListingStatus(uniqueKeys: string[], status: "favorited" | "disliked"): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("listing_status")
    .upsert(uniqueKeys.map((listing_unique_key) => ({ listing_unique_key, status })));
  if (error) throw error;
}

/** Un-favorite or un-dislike - just removes the status rows. */
export async function clearListingStatus(uniqueKeys: string[]): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("listing_status").delete().in("listing_unique_key", uniqueKeys);
  if (error) throw error;
}

/**
 * Every live listing regardless of favorite/dislike status - the comparison set
 * for deal scores (a car you hid still tells you what that model sells for).
 */
export async function fetchMarketListings(): Promise<ListingRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("listings").select("*").gt("expires_at", new Date().toISOString());
  if (error) throw error;
  return data ?? [];
}

// ---- Saved searches -----------------------------------------------------

export type SavedSearchInput = Omit<SavedSearchRow, "id" | "created_at">;

export async function fetchSavedSearches(): Promise<SavedSearchRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("saved_searches").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createSavedSearch(input: SavedSearchInput): Promise<SavedSearchRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("saved_searches").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateSavedSearch(id: string, input: SavedSearchInput): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("saved_searches").update(input).eq("id", id);
  if (error) throw error;
}

export async function deleteSavedSearch(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("saved_searches").delete().eq("id", id);
  if (error) throw error;
}

// ---- Search groups --------------------------------------------------------

export type SearchGroupWithMembers = SearchGroupRow & { saved_search_ids: string[] };

export async function fetchSearchGroups(): Promise<SearchGroupWithMembers[]> {
  const supabase = getSupabaseClient();

  const [{ data: groups, error: groupsError }, { data: members, error: membersError }] = await Promise.all([
    supabase.from("search_groups").select("*").order("created_at", { ascending: false }),
    supabase.from("search_group_members").select("*"),
  ]);
  if (groupsError) throw groupsError;
  if (membersError) throw membersError;

  return (groups ?? []).map((g) => ({
    ...g,
    saved_search_ids: (members ?? [])
      .filter((m) => m.group_id === g.id)
      .map((m) => m.saved_search_id),
  }));
}

export async function createSearchGroup(name: string, savedSearchIds: string[]): Promise<void> {
  const supabase = getSupabaseClient();

  const { data: group, error: groupError } = await supabase
    .from("search_groups")
    .insert({ name })
    .select()
    .single();
  if (groupError) throw groupError;

  if (savedSearchIds.length > 0) {
    const { error: membersError } = await supabase
      .from("search_group_members")
      .insert(savedSearchIds.map((saved_search_id) => ({ group_id: group.id, saved_search_id })));
    if (membersError) throw membersError;
  }
}

export async function deleteSearchGroup(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("search_groups").delete().eq("id", id);
  if (error) throw error;
}

// ---- Last-visit tracking (drives the NEW badge) ----------------------------

export async function getLastVisit(): Promise<string | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("app_state").select("value").eq("key", "last_visit").single();
  if (error) throw error;
  return (data?.value as AppStateValue)?.at ?? null;
}

export async function markVisitedNow(): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("app_state")
    .upsert({ key: "last_visit", value: { at: new Date().toISOString() } satisfies AppStateValue });
  if (error) throw error;
}

// ---- Scraper health ------------------------------------------------------------

/** Summary of the latest scraper run (written by index.ts); null until the first run with this feature. */
export async function getScrapeStatus(): Promise<ScrapeStatus | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("app_state").select("value").eq("key", "last_scrape").maybeSingle();
  if (error) throw error;
  return (data?.value as ScrapeStatus | undefined) ?? null;
}
