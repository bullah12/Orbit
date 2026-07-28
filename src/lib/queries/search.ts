import 'server-only';
import { asUser, type Tx } from '@/lib/db';
import type { SpaceRef } from '@/components/SpaceIndicator';
import {
  mergeResults,
  parseQuery,
  SEARCH_KINDS,
  type SearchKind,
} from '@/lib/search';

/**
 * Search — the database half.
 *
 * Five queries, one per kind, all inside one `asUser` transaction so RLS is the
 * only thing that decides what comes back. There is not a `.filter()` in this
 * file and there must never be one: if a search result appears that somebody
 * should not see, the bug is a policy.
 *
 * **Locked items.** Every one of the five indexes is partial —
 * `where not is_locked` — and every query below repeats that predicate so the
 * planner can use the index. This is not defence in depth pretending to be a
 * security boundary: a locked row is *constrained* to `title = ''` and
 * `body_md = ''`, so there is no plaintext on this server to match against in
 * the first place. There is deliberately no code path that decrypts something
 * to search it. Decision 1, and ADR section 6.
 *
 * The tsvector expression in each `where` is copied character for character
 * from the index definition in the migration. If one of them drifts, search
 * still works and quietly stops using the index; the pgTAP suite does not catch
 * that, so change both together.
 */

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  body: string;
  /** One line of context under the title — a due date, a start time, an address. */
  detail: string;
  href: string;
  rank: number;
  space: SpaceRef;
  category: { name: string; colour: string; icon: string } | null;
};

const SPACE_JSON = `jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                                       'colour', s.colour, 'icon', s.icon)`;
const CATEGORY_JSON = `case when c.id is null then null else
  jsonb_build_object('name', c.name, 'colour', c.colour, 'icon', c.icon) end`;

export type SearchResults = {
  hits: SearchHit[];
  counts: Record<SearchKind, number>;
  /** True when a kind returned exactly the per-kind cap, so there may be more. */
  capped: SearchKind[];
};

/** Per kind, before merging. Enough that no kind is cut off in practice. */
const PER_KIND = 30;

export async function search(
  userId: string,
  raw: string,
  opts: { kinds?: SearchKind[]; limit?: number } = {},
): Promise<SearchResults> {
  const q = parseQuery(raw);
  const kinds = opts.kinds?.length ? opts.kinds : [...SEARCH_KINDS];
  const empty: SearchResults = {
    hits: [],
    counts: { task: 0, note: 0, person: 0, event: 0, place: 0 },
    capped: [],
  };
  if (!q.searchable) return empty;

  return asUser(userId, async (tx) => {
    const groups: SearchHit[][] = [];
    for (const kind of SEARCH_KINDS) {
      if (!kinds.includes(kind)) continue;
      groups.push(await QUERIES[kind](tx, q.text));
    }

    const counts = { ...empty.counts };
    const capped: SearchKind[] = [];
    for (const group of groups) {
      if (group.length === 0) continue;
      counts[group[0].kind] = group.length;
      if (group.length === PER_KIND) capped.push(group[0].kind);
    }

    return { hits: mergeResults(groups, opts.limit ?? 50), counts, capped };
  });
}

type KindQuery = (tx: Tx, text: string) => Promise<SearchHit[]>;

const QUERIES: Record<SearchKind, KindQuery> = {
  task: async (tx, text) => tx<SearchHit[]>`
    select
      'task'::text as kind,
      t.id,
      t.title,
      t.body_md as body,
      trim(both ' · ' from
        concat_ws(' · ',
          t.status::text,
          case when t.due_on is null then '' else 'due ' || to_char(t.due_on, 'DD/MM/YYYY') end,
          coalesce(a.display_name, ''))) as detail,
      '/tasks/item/' || t.id::text as href,
      ts_rank(to_tsvector('english', t.title || ' ' || t.body_md),
              websearch_to_tsquery('english', ${text})) as rank,
      ${tx.unsafe(SPACE_JSON)} as space,
      ${tx.unsafe(CATEGORY_JSON)} as category
    from public.tasks t
    join public.spaces s on s.id = t.space_id
    left join public.categories c on c.id = t.category_id
    left join public.profiles a on a.id = t.assignee_id
    where not t.is_locked
      and to_tsvector('english', t.title || ' ' || t.body_md)
          @@ websearch_to_tsquery('english', ${text})
    order by rank desc, t.updated_at desc
    limit ${PER_KIND}
  `,

  note: async (tx, text) => tx<SearchHit[]>`
    select
      'note'::text as kind,
      n.id,
      n.title,
      n.body_md as body,
      case when n.archived_at is null then '' else 'archived' end as detail,
      '/notes/' || n.id::text as href,
      ts_rank(to_tsvector('english', n.title || ' ' || n.body_md),
              websearch_to_tsquery('english', ${text})) as rank,
      ${tx.unsafe(SPACE_JSON)} as space,
      ${tx.unsafe(CATEGORY_JSON)} as category
    from public.notes n
    join public.spaces s on s.id = n.space_id
    left join public.categories c on c.id = n.category_id
    where not n.is_locked
      and to_tsvector('english', n.title || ' ' || n.body_md)
          @@ websearch_to_tsquery('english', ${text})
    order by rank desc, n.updated_at desc
    limit ${PER_KIND}
  `,

  person: async (tx, text) => tx<SearchHit[]>`
    select
      'person'::text as kind,
      p.id,
      p.display_name as title,
      p.notes_md as body,
      trim(both ' · ' from
        concat_ws(' · ',
          coalesce(p.nickname, ''),
          case when p.archived_at is null then '' else 'archived' end)) as detail,
      '/people/' || p.id::text as href,
      ts_rank(to_tsvector('english',
                p.display_name || ' ' || coalesce(p.nickname, '') || ' ' || p.notes_md),
              websearch_to_tsquery('english', ${text})) as rank,
      ${tx.unsafe(SPACE_JSON)} as space,
      ${tx.unsafe(CATEGORY_JSON)} as category
    from public.people p
    join public.spaces s on s.id = p.space_id
    left join public.categories c on c.id = p.category_id
    where not p.is_locked
      and to_tsvector('english',
            p.display_name || ' ' || coalesce(p.nickname, '') || ' ' || p.notes_md)
          @@ websearch_to_tsquery('english', ${text})
    order by rank desc, p.display_name
    limit ${PER_KIND}
  `,

  event: async (tx, text) => tx<SearchHit[]>`
    select
      'event'::text as kind,
      e.id,
      e.title,
      e.body_md as body,
      trim(both ' · ' from
        concat_ws(' · ',
          to_char(e.starts_at at time zone 'Europe/London', 'DD/MM/YYYY'),
          case when e.all_day then 'all day'
               else to_char(e.starts_at at time zone 'Europe/London', 'HH24:MI') end,
          coalesce(e.location_text, ''))) as detail,
      '/calendar/event/' || e.id::text as href,
      ts_rank(to_tsvector('english', e.title || ' ' || e.body_md),
              websearch_to_tsquery('english', ${text})) as rank,
      ${tx.unsafe(SPACE_JSON)} as space,
      ${tx.unsafe(CATEGORY_JSON)} as category
    from public.events e
    join public.spaces s on s.id = e.space_id
    left join public.categories c on c.id = e.category_id
    where not e.is_locked
      and to_tsvector('english', e.title || ' ' || e.body_md)
          @@ websearch_to_tsquery('english', ${text})
    order by rank desc, e.starts_at desc
    limit ${PER_KIND}
  `,

  place: async (tx, text) => tx<SearchHit[]>`
    select
      'place'::text as kind,
      pl.id,
      pl.name as title,
      pl.notes_md as body,
      trim(both ' · ' from
        concat_ws(' · ',
          coalesce(pl.address_text, ''),
          coalesce(pl.postcode, ''),
          case when pl.archived_at is null then '' else 'archived' end)) as detail,
      '/places/' || pl.id::text as href,
      ts_rank(to_tsvector('english',
                pl.name || ' ' || coalesce(pl.address_text, '') || ' ' || pl.notes_md),
              websearch_to_tsquery('english', ${text})) as rank,
      ${tx.unsafe(SPACE_JSON)} as space,
      ${tx.unsafe(CATEGORY_JSON)} as category
    from public.places pl
    join public.spaces s on s.id = pl.space_id
    left join public.categories c on c.id = pl.category_id
    where not pl.is_locked
      and to_tsvector('english',
            pl.name || ' ' || coalesce(pl.address_text, '') || ' ' || pl.notes_md)
          @@ websearch_to_tsquery('english', ${text})
    order by rank desc, pl.name
    limit ${PER_KIND}
  `,
};

/**
 * How many locked items the caller holds, by kind.
 *
 * Search says "N locked items were not searched" rather than saying nothing.
 * Silence would be indistinguishable from "there is nothing there", and the one
 * thing somebody must never conclude is that a locked note has been read by
 * anything. This counts rows the caller can already see — it discloses no
 * content, because there is none to disclose.
 */
export async function countLocked(userId: string): Promise<number> {
  return asUser(userId, async (tx) => {
    const [row] = await tx<{ n: number }[]>`
      select (
        (select count(*) from public.tasks  where is_locked) +
        (select count(*) from public.notes  where is_locked) +
        (select count(*) from public.people where is_locked) +
        (select count(*) from public.events where is_locked) +
        (select count(*) from public.places where is_locked)
      )::int as n
    `;
    return row?.n ?? 0;
  });
}
