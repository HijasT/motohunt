import { createHash } from "node:crypto";

/** Same car scraped again gets the same key, regardless of which run found it. */
export function uniqueKeyFor(source: string, link: string): string {
  return createHash("sha256").update(`${source}|${link}`).digest("hex");
}
