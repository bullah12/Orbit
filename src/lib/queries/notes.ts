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
  updatedAt: string;
  space: SpaceRef;
  category: { name: string; colour: string; icon: string } | null;
  linkCount: number;
};

export async function listNotes(
  userId: string,
  opts: { spaceId?: string | null; limit?: number } = {},
): Promise<NoteRow[]> {
  const { spaceId = null, limit = 200 } = opts;
  return asUser(userId, async (tx) => {
    return tx<NoteRow[]>`
      select
        n.id, n.title, n.body_md as "bodyMd", n.visibility::text as visibility,
        n.is_locked as "isLocked", n.pinned_at as "pinnedAt", n.updated_at as "updatedAt",
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
      where n.archived_at is null
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
        n.is_locked as "isLocked", n.pinned_at as "pinnedAt", n.updated_at as "updatedAt",
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
