import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { countLocked, search, type SearchHit } from '@/lib/queries/search';
import {
  describeCounts,
  isSearchKind,
  KIND_ICON,
  KIND_LABEL,
  KIND_PLURAL,
  parseQuery,
  SEARCH_KINDS,
  snippet,
  type SearchKind,
  type Segment,
} from '@/lib/search';
import { SpaceIndicator, CategoryChip } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { plural } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Search.
 *
 * One box, five kinds, every result carrying its space indicator — because a
 * result you cannot place is a result you have to open to understand, and
 * search exists so you do not have to.
 *
 * The page never filters anything. RLS decides what the query returns; the
 * kind checkboxes decide which of the five queries are *asked*, which is a
 * different thing entirely — unticking "Notes" does not hide notes you could
 * see, it declines to look for them.
 *
 * Locked items are absent by construction: they have no plaintext on the
 * server. The page says how many there are rather than staying quiet about it,
 * because silence reads as "there is nothing there".
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string | string[] }>;
}) {
  const params = await searchParams;
  const user = await requireUser();

  const q = parseQuery(params.q);
  const requested = (Array.isArray(params.kind) ? params.kind : params.kind ? [params.kind] : [])
    .filter(isSearchKind);
  const kinds: SearchKind[] = requested.length ? requested : [...SEARCH_KINDS];

  const [results, locked] = await Promise.all([
    search(user.id, q.text, { kinds }),
    countLocked(user.id),
  ]);

  const summary = describeCounts(results.counts);

  return (
    <div className="flex min-h-screen flex-col">
      {/* A back arrow and a field, the way a search screen reached from a
          header icon should look — not a page title above a form. The heading
          is still there for a screen reader; the field is what a person needs. */}
      <header className="hairline border-b px-5 pb-3.5 pt-1">
        <h1 className="sr-only">Search</h1>

        <form method="get" action="/search" className="flex items-center gap-2" role="search">
          <Link
            href="/"
            aria-label="Back"
            className="row-hover -ml-3 flex h-11 w-11 shrink-0 items-center justify-center rounded"
          >
            <Icon name="chevron" size={21} className="muted rotate-180" />
          </Link>

          <div
            className="hairline flex min-h-11 flex-1 items-center gap-2 rounded-lg border px-3"
            style={{ background: 'var(--bg-raised)' }}
          >
            <Icon name="search" size={17} className="faint shrink-0" />
            <label htmlFor="q" className="sr-only">
              Search terms
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={q.text}
              autoFocus
              placeholder="bins, Sadia, half three…"
              className="min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-[color:var(--text-faint)]"
              style={{ appearance: 'none' }}
            />
            {/* The kinds ride along, so clearing the words does not silently
                widen what is being looked in. */}
            {requested.map((k) => (
              <input key={k} type="hidden" name="kind" value={k} />
            ))}
            <button type="submit" className="sr-only">
              Search
            </button>
          </div>
        </form>

        <p className="muted mt-2 text-xs">
          Tasks, notes, people, events and places. What you can find is decided
          by the spaces you are in, not by this page.
        </p>
      </header>

      <KindChips q={q.text} requested={requested} searched={kinds} counts={results.counts} />

      <div className="hairline flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-5 py-2">
        <p aria-live="polite" className="muted text-xs">
          {!q.searchable
            ? 'Type something to search for.'
            : results.hits.length === 0
              ? `Nothing matches “${q.text}”.`
              : `${plural(results.hits.length, 'result')} — ${summary}`}
        </p>
        {locked > 0 && (
          <p className="faint inline-flex items-center gap-1 text-2xs">
            <Icon name="lock" size={11} />
            {plural(locked, 'locked item')} not searched — locked items have no
            plaintext on the server to search.
          </p>
        )}
        {results.capped.length > 0 && (
          <p className="faint text-2xs">
            Showing the first 30 {results.capped.map((k) => KIND_PLURAL[k].toLowerCase()).join(' and ')}.
            Narrow the query to see the rest.
          </p>
        )}
      </div>

      <ul id="search-results" className="flex flex-col">
        {results.hits.map((hit) => (
          <Result key={`${hit.kind}:${hit.id}`} hit={hit} terms={q.terms} />
        ))}
      </ul>

      {q.searchable && results.hits.length === 0 && (
        <p className="muted px-5 py-8 text-sm">
          No task, note, person, event or place in your spaces matches that.
          Try fewer words — the search is whole-word, so “bin” does not find
          “bins”.
        </p>
      )}
    </div>
  );
}

/**
 * The five kinds, as a scrolling row of count chips.
 *
 * They were five checkboxes in a `fieldset`, which on a 390px screen wrapped
 * to three lines of 12px labels above the results — a control taller than the
 * first result, for something most people set once and never touch. As chips
 * they are one line that scrolls, each one carrying its own number.
 *
 * **Links, not inputs, and the same GET.** Each chip is the URL you would have
 * got by ticking that box and pressing Search, so the page stays bookmarkable,
 * the back button undoes a filter, and no JavaScript is needed to change one.
 * They toggle rather than select: tapping an active chip takes that kind out,
 * exactly as unticking it did. Removing the last one lands on All, because
 * "search nothing" is not a state worth being able to reach.
 *
 * **A chip only shows a number if that kind was actually searched**, and that
 * is deliberate. The page's standing rule is that unticking a kind does not
 * hide results you could see, it declines to look for them — so a count for a
 * kind nobody looked for would have to come from a sixth query run purely to
 * populate a label, and would quietly turn the filter into a display filter.
 * With no filter set, which is how the page arrives, all five were searched
 * and all five have numbers.
 */
function KindChips({
  q,
  requested,
  searched,
  counts,
}: {
  q: string;
  /** What the URL asked for. Empty means "all five", which is the default. */
  requested: SearchKind[];
  /** What was actually searched — the same five when nothing was requested. */
  searched: SearchKind[];
  counts: Partial<Record<SearchKind, number>>;
}) {
  const href = (kinds: SearchKind[]) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    for (const k of kinds) p.append('kind', k);
    const qs = p.toString();
    return `/search${qs ? `?${qs}` : ''}`;
  };

  const total = searched.reduce((n, k) => n + (counts[k] ?? 0), 0);
  const all = requested.length === 0;

  return (
    <nav
      className="chipbar hairline border-b px-5 py-2.5"
      aria-label="Which kinds to search"
      id="search-kinds"
    >
      <Link href={href([]) as never} aria-current={all ? 'true' : undefined}>
        All
        <span className="faint tabular-nums">{total}</span>
      </Link>

      {SEARCH_KINDS.map((kind) => {
        const on = requested.includes(kind);
        const next = on ? requested.filter((k) => k !== kind) : [...requested, kind];
        const n = searched.includes(kind) ? counts[kind] ?? 0 : null;
        return (
          <Link
            key={kind}
            href={href(next) as never}
            aria-current={on ? 'true' : undefined}
          >
            {KIND_PLURAL[kind]}
            {n != null && <span className="faint tabular-nums">{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

function Result({ hit, terms }: { hit: SearchHit; terms: string[] }) {
  const segments = snippet(hit.body, terms);
  return (
    <li className="hairline border-b">
      <Link href={hit.href as never} className="row-hover flex flex-col gap-1 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <SpaceIndicator space={hit.space} />
          <KindChip kind={hit.kind} />
          <span className="text-sm font-medium">
            <Marked segments={snippet(hit.title, terms, 120)} fallback={hit.title} />
          </span>
          <CategoryChip category={hit.category} />
        </div>
        {hit.detail && <p className="faint text-2xs">{hit.detail}</p>}
        {segments.length > 0 && (
          <p className="muted text-xs">
            <Marked segments={segments} fallback="" />
          </p>
        )}
      </Link>
    </li>
  );
}

/**
 * The kind chip is neutral chrome, not colour. Category colour is the only
 * strong colour in Orbit (standing rule), and a search result already spends it
 * on the category chip next door.
 */
function KindChip({ kind }: { kind: SearchKind }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-2xs"
      style={{ background: 'var(--bg-sunken)', color: 'var(--text-muted)' }}
    >
      <Icon name={KIND_ICON[kind]} size={11} />
      {KIND_LABEL[kind]}
    </span>
  );
}

/**
 * Highlighting without markup crossing a string boundary.
 *
 * `ts_headline` would hand back `<b>` in a string, which is the one shape that
 * cannot reach React without dangerouslySetInnerHTML. Segments can.
 */
function Marked({ segments, fallback }: { segments: Segment[]; fallback: string }) {
  if (segments.length === 0) return <>{fallback}</>;
  return (
    <>
      {segments.map((seg, i) =>
        seg.hit ? (
          <mark
            key={i}
            style={{ background: 'var(--bg-hover)', color: 'inherit', fontWeight: 600 }}
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}
