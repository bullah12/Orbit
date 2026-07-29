/**
 * Search — the pure half.
 *
 * The database decides *what can be found*: five partial GIN indexes, every one
 * of them `where not is_locked`, and RLS on top of that. Nothing in this file
 * filters anything a policy should have filtered — it only decides what a
 * result *looks like* and what order the five kinds come back in.
 *
 * Locked items have no plaintext on the server at all (the table constraints
 * force `title = '' and body_md = ''`), so they cannot match. That is worth
 * saying out loud because it means there is no "exclude the locked ones" branch
 * anywhere: there is nothing to exclude.
 */

export const SEARCH_KINDS = ['task', 'note', 'person', 'event', 'place'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const KIND_LABEL: Record<SearchKind, string> = {
  task: 'Task',
  note: 'Note',
  person: 'Person',
  event: 'Event',
  place: 'Place',
};

export const KIND_PLURAL: Record<SearchKind, string> = {
  task: 'Tasks',
  note: 'Notes',
  person: 'People',
  event: 'Events',
  place: 'Places',
};

export const KIND_ICON: Record<SearchKind, string> = {
  task: 'check',
  note: 'note',
  person: 'user',
  event: 'calendar',
  place: 'map_pin',
};

export function isSearchKind(v: unknown): v is SearchKind {
  return typeof v === 'string' && (SEARCH_KINDS as readonly string[]).includes(v);
}

/**
 * The longest a query may be.
 *
 * `websearch_to_tsquery` is safe against anything, but a 10kB query string in a
 * URL is somebody's mistake and there is no answer worth computing for it.
 */
export const MAX_QUERY = 200;

export type ParsedQuery = {
  /** What goes to `websearch_to_tsquery`. Empty when there is nothing to search for. */
  text: string;
  /** Lower-cased words, for highlighting. Quotes and operators stripped. */
  terms: string[];
  /** True when running this query is worth a round trip. */
  searchable: boolean;
};

/**
 * Normalise what somebody typed.
 *
 * Deliberately *not* an escaping function — `websearch_to_tsquery` takes user
 * text as user text, quotes and `or` and `-word` included, and building our own
 * tsquery string would be reintroducing an injection surface Postgres already
 * closed. This trims, caps the length, and works out which words to highlight.
 */
export function parseQuery(raw: string | null | undefined): ParsedQuery {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
  const terms = Array.from(
    new Set(
      text
        .toLowerCase()
        // Drop websearch's own operators so we do not highlight the word "or".
        .replace(/"/g, ' ')
        .split(' ')
        .map((w) => (w.startsWith('-') ? '' : w))
        .filter((w) => w.length > 0 && w !== 'or' && w !== 'and'),
    ),
  );
  return { text, terms, searchable: terms.length > 0 };
}

// ---------------------------------------------------------------------------
// Snippets
// ---------------------------------------------------------------------------

export type Segment = { text: string; hit: boolean };

const ELLIPSIS = '…';

/**
 * A window of `body` around the first term that matches, split into segments so
 * the caller can mark the hits without ever building HTML.
 *
 * `ts_headline` would do this in Postgres, but it takes a second pass over the
 * document per row and it returns markup as a string — which is the one shape
 * that cannot cross into React without a dangerouslySetInnerHTML. Segments can.
 */
export function snippet(
  body: string,
  terms: string[],
  width = 160,
): Segment[] {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (!flat) return [];

  const hits = findHits(flat, terms);

  // No term in the body — the title probably matched. Show the opening.
  const start = hits.length === 0 ? 0 : windowStart(flat, hits[0].at, width);
  const end = Math.min(flat.length, start + width);
  const cut = flat.slice(start, end);

  const segments: Segment[] = [];
  if (start > 0) segments.push({ text: ELLIPSIS, hit: false });

  let cursor = 0;
  for (const hit of hits) {
    const at = hit.at - start;
    if (at < cursor || at + hit.length > cut.length) continue;
    if (at > cursor) segments.push({ text: cut.slice(cursor, at), hit: false });
    segments.push({ text: cut.slice(at, at + hit.length), hit: true });
    cursor = at + hit.length;
  }
  if (cursor < cut.length) segments.push({ text: cut.slice(cursor), hit: false });
  if (end < flat.length) segments.push({ text: ELLIPSIS, hit: false });

  return segments.filter((s) => s.text.length > 0);
}

/**
 * A crude English stem, for highlighting only.
 *
 * Postgres searches with the `english` dictionary, so typing "bins" returns a
 * task whose title says "bin bags" — and a highlighter that looks for the
 * literal string would mark nothing on the very row it just found, which reads
 * as a bug in the search rather than in the highlighting. Snowball is not worth
 * shipping for this: the plural is the case that matters, and being
 * occasionally too generous about which word to embolden costs nothing.
 *
 * This never decides *what matches* — Postgres already did that. It decides
 * what to embolden in a row that has already been returned.
 */
export function looseStem(word: string): string {
  let w = word.toLowerCase().replace(/['’]s$/, '');
  if (/ies$/.test(w) && w.length > 4) return w.slice(0, -3) + 'y';
  if (/(ses|xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (/[^s]s$/.test(w) && w.length > 2) return w.slice(0, -1);
  if (/ing$/.test(w) && w.length > 5) return w.slice(0, -3);
  if (/ed$/.test(w) && w.length > 4) return w.slice(0, -2);
  return w;
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

/**
 * Every word of `flat` that one of the terms accounts for, in document order.
 *
 * Word-aligned rather than substring-aligned: emboldening the "not" inside
 * "nothing" is noise, and Postgres would not have matched it either.
 */
function findHits(flat: string, terms: string[]): { at: number; length: number }[] {
  const stems = new Set(terms.filter(Boolean).map(looseStem));
  if (stems.size === 0) return [];

  const kept: { at: number; length: number }[] = [];
  WORD.lastIndex = 0;
  for (const m of flat.matchAll(WORD)) {
    const word = m[0];
    if (!stems.has(looseStem(word))) continue;
    kept.push({ at: m.index, length: word.length });
  }
  return kept;
}

/** Back up to a word boundary so a snippet never starts mid-word. */
function windowStart(flat: string, at: number, width: number): number {
  const ideal = Math.max(0, at - Math.floor(width / 3));
  if (ideal === 0) return 0;
  const space = flat.indexOf(' ', ideal);
  return space >= 0 && space < at ? space + 1 : ideal;
}

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

export type Ranked = { kind: SearchKind; rank: number };

/**
 * Interleave the five kinds into one list.
 *
 * Each kind is queried separately, because each has its own columns and its own
 * idea of a subtitle. Ranking them into one list is not a visibility decision —
 * RLS already made that — it is an ordering decision, and it has one rule worth
 * stating: **no kind may crowd the others out**. Ten matching tasks must not
 * bury the one person whose name you actually typed, so the first result of
 * every kind is promoted ahead of the second result of any kind.
 */
export function mergeResults<T extends Ranked>(groups: T[][], limit = 50): T[] {
  const queues = groups
    .map((g) => [...g].sort((a, b) => b.rank - a.rank))
    .filter((g) => g.length > 0);

  const out: T[] = [];
  let round = 0;
  while (out.length < limit) {
    const layer = queues.map((q) => q[round]).filter((x): x is T => x !== undefined);
    if (layer.length === 0) break;
    layer.sort((a, b) => b.rank - a.rank);
    for (const item of layer) {
      if (out.length >= limit) break;
      out.push(item);
    }
    round += 1;
  }
  return out;
}

/** "3 tasks · 1 note · 2 people", for the count line above the results. */
export function describeCounts(counts: Partial<Record<SearchKind, number>>): string {
  const parts: string[] = [];
  for (const kind of SEARCH_KINDS) {
    const n = counts[kind] ?? 0;
    if (n > 0) parts.push(`${n} ${n === 1 ? KIND_LABEL[kind].toLowerCase() : KIND_PLURAL[kind].toLowerCase()}`);
  }
  return parts.join(' · ');
}
