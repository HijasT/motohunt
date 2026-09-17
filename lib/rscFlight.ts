/**
 * Minimal reader for Next.js App Router's RSC "Flight" wire format -
 * `self.__next_f.push([1, "<id>:<json>\n<id>:<json>..."])` script tags that
 * carry server-rendered data down to the client.
 *
 * This is what Cars24 uses instead of schema.org JSON-LD: their listing cards
 * are server-rendered, but the data lives in this internal protocol rather
 * than a public one. It's a much less stable contract than JSON-LD (it's
 * Next.js/React internals, not a spec aimed at search engines), so treat this
 * as the first thing to check if scrapers/cars24.ts starts coming back empty.
 *
 * The format: each push is a sequence of `<hex-id>:<payload>` lines sharing
 * ONE namespace across every push on the page (an id defined in one <script>
 * tag can be referenced from another). A payload is either a JSON value, or a
 * bare string. Object/array values can reference another id with `"$<id>"`,
 * which must be resolved by looking that id up and substituting it in.
 */

const PUSH_RE = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
const ID_PREFIX_RE = /^[0-9a-f]+:/;

/**
 * Splits one push's raw text into `[id, payload]` pairs. A naive
 * `split(/\n(?=[0-9a-f]+:)/)` breaks whenever a payload's own JSON contains an
 * embedded newline followed by something that happens to look like an id
 * prefix (observed in practice on Cars24 - a nested object split mid-value,
 * silently truncating it instead of erroring). So instead this tracks JSON
 * nesting depth and string state, and only treats a newline as a boundary
 * when it's outside any string/object/array *and* immediately followed by a
 * real `<hex>:` prefix.
 */
function splitFlightLines(raw: string): [string, string][] {
  const pairs: [string, string][] = [];
  let i = 0;

  while (i < raw.length) {
    if (raw[i] === "\n") {
      i++;
      continue;
    }
    const idMatch = ID_PREFIX_RE.exec(raw.slice(i));
    if (!idMatch) break;

    const id = idMatch[0].slice(0, -1);
    const payloadStart = i + idMatch[0].length;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let payloadEnd = raw.length;
    let j = payloadStart;

    for (; j < raw.length; j++) {
      const ch = raw[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === "{" || ch === "[") {
        depth++;
      } else if (ch === "}" || ch === "]") {
        depth--;
      } else if (depth <= 0 && ch === "\n" && ID_PREFIX_RE.test(raw.slice(j + 1))) {
        payloadEnd = j;
        break;
      }
    }

    pairs.push([id, raw.slice(payloadStart, payloadEnd)]);
    i = payloadEnd;
  }

  return pairs;
}

/** Parses every push on the page into one shared id -> value store. */
export function parseFlightStore(html: string): Map<string, unknown> {
  const store = new Map<string, unknown>();

  // Each push is a fixed-size fragment of ONE continuous stream, not a
  // self-contained unit - a single field (an SEO description, say) can be
  // long enough to get cut mid-value and continue in the next push. So every
  // push's text must be joined back together, in document order, before
  // looking for `<id>:<payload>` boundaries - splitting per push truncates
  // whatever value happened to straddle a chunk boundary.
  let combined = "";
  for (const match of html.matchAll(PUSH_RE)) {
    try {
      // The captured text is a JS string literal's contents; JSON's escaping
      // rules are a compatible enough subset to unescape it correctly.
      combined += JSON.parse(`"${match[1]}"`);
    } catch {
      // A malformed fragment would corrupt everything downstream of it - but
      // skipping it would too (the next fragment likely continues mid-value).
      // Fall through and let the rest of the stream fail to parse loudly
      // rather than silently, so a real break here isn't mistaken for "no
      // listings" upstream.
    }
  }

  for (const [id, payload] of splitFlightLines(combined)) {
    try {
      store.set(id, JSON.parse(payload));
    } catch {
      store.set(id, payload);
    }
  }

  return store;
}

/** Recursively replaces `"$<id>"` references with the value they point to. */
export function resolveFlight(value: unknown, store: Map<string, unknown>, depth = 0): unknown {
  if (depth > 8) return value; // guard against a reference cycle

  if (typeof value === "string" && /^\$[0-9a-f]+$/.test(value)) {
    const ref = value.slice(1);
    return store.has(ref) ? resolveFlight(store.get(ref), store, depth + 1) : value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveFlight(v, store, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveFlight(v, store, depth + 1);
    }
    return out;
  }
  return value;
}

/** Finds every fully-resolved object in the store that has all of `requiredKeys`. */
export function findRecords(
  html: string,
  requiredKeys: string[]
): Record<string, unknown>[] {
  const store = parseFlightStore(html);
  const records: Record<string, unknown>[] = [];

  for (const value of store.values()) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      requiredKeys.every((k) => k in (value as Record<string, unknown>))
    ) {
      records.push(resolveFlight(value, store) as Record<string, unknown>);
    }
  }

  return records;
}
