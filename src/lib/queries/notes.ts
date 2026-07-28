import 'server-only';
import { asUser } from '@/lib/db';
import type { SpaceRef } from '@/components/SpaceIndicator';

export type NoteRow = {
  id: string;
  title: string;
  bodyMd: string;
  visibility: string;
  isLocked: boolean;
  pinnedAt: string | null;
  archivedAt: string | null;
  updatedAt: string;
  space: SpaceRef;
  category: { name: string; colour: string; icon: string } | null;
  linkCount: number;
};

export async function listNotes(
  userId: string,
  opts: { spaceId?: string | null; limit?: number; archived?: boolean } = {},
): Promise<NoteRow[]> {
  const { spaceId = null, limit = 200, archived = false } = opts;
  return asUser(userId, async (tx) => {
    return tx<NoteRow[]>`
      select
        n.id, n.title, n.body_md as "bodyMd", n.visibility::text as visibility,
        n.is_locked as "isLocked", n.pinned_at as "pinnedAt",
        n.archived_at as "archivedAt", n.updated_at as "updatedAt",
        jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                           'colour', s.colour, 'icon', s.icon) as space,
        case when c.id is null then null else
          jsonb_build_object('name', c.name, 'colour', c.colour, 'icon', c.icon) end as category,
        coalesce(l.n, 0) as "linkCount"
      from public.notes n
      join public.spaces s on s.id = n.space_id
      left join public.categories c on c.id = n.category_id
      left join lateral (
        select count(*)::int as n from public.note_links l where l.note_id = n.id
      ) l on true
      where ${archived ? tx`n.archived_at is not null` : tx`n.archived_at is null`}
        ${spaceId ? tx`and n.space_id = ${spaceId}::uuid` : tx``}
      order by n.pinned_at desc nulls last, n.updated_at desc
      limit ${limit}
    `;
  });
}

export type NoteLink = {
  entityKind: string;
  entityId: string;
  label: string;
};

export async function getNote(
  userId: string,
  id: string,
): Promise<{ note: NoteRow; links: NoteLink[] } | null> {
  return asUser(userId, async (tx) => {
    const rows = await tx<NoteRow[]>`
      select
        n.id, n.title, n.body_md as "bodyMd", n.visibility::text as visibility,
        n.is_locked as "isLocked", n.pinned_at as "pinnedAt",
        n.archived_at as "archivedAt", n.updated_at as "updatedAt",
        jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                           'colour', s.colour, 'icon', s.icon) as space,
        case when c.id is null then null else
          jsonb_build_object('name', c.name, 'colour', c.colour, 'icon', c.icon) end as category,
        0 as "linkCount"
      from public.notes n
      join public.spaces s on s.id = n.space_id
      left join public.categories c on c.id = n.category_id
      where n.id = ${id}::uuid
    `;
    const note = rows[0];
    if (!note) return null;

    // Resolving a link's label means reading the linked row, which is itself
    // policy-checked — a link to something you cannot see resolves to nothing
    // rather than leaking a title.
    const links = await tx<NoteLink[]>`
      select l.entity_kind::text as "entityKind", l.entity_id as "entityId",
             coalesce(t.title, p.display_name, pl.name, e.title, '—') as label
      from public.note_links l
      left join public.tasks  t  on l.entity_kind = 'task'   and t.id  = l.entity_id
      left join public.people p  on l.entity_kind = 'person' and p.id  = l.entity_id
      left join public.places pl on l.entity_kind = 'place'  and pl.id = l.entity_id
      left join public.events e  on l.entity_kind = 'event'  and e.id  = l.entity_id
      where l.note_id = ${id}::uuid
      order by l.entity_kind, label
    `;
    return { note, links };
  });
}

export type LinkTarget = { kind: 'task' | 'person' | 'place' | 'event'; id: string; label: string };

/**
 * Things a note in this space can be linked to.
 *
 * Scoped to the note's own space by the `where` *and* by the policies — a link
 * across a space boundary would put an item on a screen whose space does not
 * govern it. Locked items are excluded because their labels do not exist.
 */
export async function listLinkTargets(
  userId: string,
  spaceId: string,
): Promise<LinkTarget[]> {
  return asUser(userId, async (tx) => {
    return tx<LinkTarget[]>`
      (select 'task'::text as kind, t.id, t.title as label
         from public.tasks t
        where t.space_id = ${spaceId}::uuid and not t.is_locked
          and t.status in ('todo','doing','blocked')
        order by t.title limit 100)
      union all
      (select 'person', p.id, p.display_name
         from public.people p
        where p.space_id = ${spaceId}::uuid and not p.is_locked and p.archived_at is null
        order by p.display_name limit 100)
      union all
      (select 'place', pl.id, pl.name
         from public.places pl
        where pl.space_id = ${spaceId}::uuid
        order by pl.name limit 100)
      union all
      (select 'event', e.id,
              e.title || ' — ' || to_char(e.starts_at at time zone 'Europe/London', 'DD/MM/YYYY')
         from public.events e
        where e.space_id = ${spaceId}::uuid and e.status <> 'cancelled'
          and e.starts_at > now() - interval '30 days'
        order by e.starts_at desc limit 100)
    `;
  });
}

/** Today's quiet row: yesterday's events, and whether anything was written down. */
export async function yesterdaySummary(
  userId: string,
): Promise<{ eventCount: number; noteCount: number }> {
  const rows = await asUser(userId, async (tx) => {
    return tx<{ eventCount: number; noteCount: number }[]>`
      select
        (select count(*)::int from public.events e
          where e.status <> 'cancelled'
            and e.starts_at >= date_trunc('day', now() at time zone 'Europe/London') - interval '1 day'
            and e.starts_at <  date_trunc('day', now() at time zone 'Europe/London')
        ) as "eventCount",
        (select count(*)::int from public.notes n
          where n.created_at >= date_trunc('day', now() at time zone 'Europe/London') - interval '1 day'
            and n.created_at <  date_trunc('day', now() at time zone 'Europe/London')
        ) as "noteCount"
    `;
  });
  return rows[0] ?? { eventCount: 0, noteCount: 0 };
}
