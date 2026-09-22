// Canonical ad-link keys. Import-free on purpose (same reason as
// lib/supabase/types.ts): shared by the Next.js frontend and the tsx-run scripts.

/**
 * Canonical form of an ad URL, for matching the same ad across differently
 * written links (ranks typed in a chat, scraped listings, link-check results).
 * Uses the site's own ad id where the URL carries one, because the rest of the
 * URL isn't stable:
 *   - Dubizzle embeds a per-visit tracking number and the emirate subdomain
 *     (".../x-trail-se-2022-2-957---c254c340.../" vs "...-2-395---c254c340..."),
 *     so only the 32-hex id after "---" identifies the ad.
 *   - CarSwitch serves one ad at both /car/<id>/ad and /<city>/used-car/.../<id>.
 * Otherwise: host lowercased, "www." / query string / fragment / trailing slash dropped.
 */
export function normLink(link: string): string {
  try {
    const u = new URL(link.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    const dubizzleId = host.endsWith("dubizzle.com") ? path.match(/---([0-9a-f]{32})$/i)?.[1] : undefined;
    if (dubizzleId) return `dubizzle:${dubizzleId.toLowerCase()}`;
    const carswitchId = host === "carswitch.com" ? path.match(/\/(\d+)(?:\/ad)?$/)?.[1] : undefined;
    if (carswitchId) return `carswitch:${carswitchId}`;
    return `${host}${path}`;
  } catch {
    return link.trim().toLowerCase();
  }
}
