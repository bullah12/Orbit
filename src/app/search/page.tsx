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
      <header className="hairline border-b px-5 py-4">
        <h1 className="text-[15px] font-semibold">Search</h1>
        <p className="muted mt-0.5 text-[12px]">
          Tasks, notes, people, events and places. What you can find is decided
          by the spaces you are in, not by this page.
        </p>

        <form method="get" action="/search" className="mt-3 flex flex-col gap-2" role="search">
          <div className="flex flex-wrap items-center gap-2">
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
              className="input max-w-md"
              style={{ width: '24rem' }}
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[13px]"
              style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
            >
              <Icon name="search" size={13} />
              Search
            </button>
          </div>

          <fieldset className="flex flex-wrap items-center gap-3">
            <legend className="faint text-[11px] font-semibold uppercase tracking-wider">
              Look in
            </legend>
            {SEARCH_KINDS.map((kind) => (
              <label key={kind} className="flex items-center gap-1.5 text-[12px]">
                <input
                  type="checkbox"
                  name="kind"
                  value={kind}
                  defaultChecked={kinds.includes(kind)}
                />
                <Icon name={KIND_ICON[kind]} size={12} className="muted" />
                {KIND_PLURAL[kind]}
              </label>
            ))}
          </fieldset>
        </form>
      </header>

      <div className="hairline flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-5 py-2">
        <p aria-live="polite" className="muted text-[12px]">
          {!q.searchable
            ? 'Type something to search for.'
            : results.hits.length === 0
              ? `Nothing matches “${q.text}”.`
              : `${plural(results.hits.length, 'result')} — ${summary}`}
        </p>
        {locked > 0 && (
          <p className="faint inline-flex items-center gap-1 text-[11px]">
            <Icon name="lock" size={11} />
            {plural(locked, 'locked item')} not searched — locked items have no
            plaintext on the server to search.
          </p>
        )}
        {results.capped.length > 0 && (
          <p className="faint text-[11px]">
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
        <p className="muted px-5 py-8 text-[13px]">
          No task, note, person, event or place in your spaces matches that.
          Try fewer words — the search is whole-word, so “bin” does not find
          “bins”.
        </p>
      )}
    </div>
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
          <span className="text-[13px] font-medium">
            <Marked segments={snippet(hit.title, terms, 120)} fallback={hit.title} />
          </span>
          <CategoryChip category={hit.category} />
        </div>
        {hit.detail && <p className="faint text-[11px]">{hit.detail}</p>}
        {segments.length > 0 && (
          <p className="muted text-[12px]">
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
      className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] leading-tight"
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
