import 'server-only';
import { asUser } from '@/lib/db';
import { captureInstants, parseCapture, type Capture } from '@/lib/capture';

/**
 * Capture's database side.
 *
 * The parsing is pure and lives in `src/lib/capture/` — it never comes near
 * this file's imports, and this file never sends what somebody typed anywhere.
 * What happens here is the ordinary thing: resolve the hints against real rows
 * the caller can already see, and insert one row through `asUser`, so RLS
 * decides whether the write is allowed exactly as it does everywhere else.
 *
 * The text is re-parsed here rather than trusted from the form. The preview the
 * person read was produced by the same function on the same text, so re-parsing
 * cannot disagree with it — and a form that posted a date instead of the words
 * would be a form somebody could edit into a date the preview never showed.
 */

export type CaptureTarget = {
  spaceId: string;
  /** Overrides the parsed kind when somebody corrects it on the preview. */
  kind?: Capture['kind'];
};

export type Created = { kind: Capture['kind']; id: string; href: string };

/**
 * Resolve `#work` against the spaces the caller can write to.
 *
 * Matched against the short label and the name, both lower-cased. An
 * unrecognised hint resolves to nothing rather than to a guess: creating
 * something in the wrong space is the one mistake this surface must not make,
 * because the space is what decides who else can read it.
 */
export async function resolveSpaceHint(
  userId: string,
  hint: string | null,
): Promise<string | null> {
  if (!hint) return null;
  return asUser(userId, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      select s.id
      from orbit.spaces s
      join orbit.space_members m on m.space_id = s.id and m.user_id = ${userId}::uuid
      where m.status = 'active'
        and m.role in ('owner','admin','member')
        and (lower(s.short_label) = ${hint} or lower(s.name) = ${hint})
      limit 1
    `;
    return row?.id ?? null;
  });
}

/** Resolve `@danny` against the members of the space being written to. */
async function resolveAssignee(
  userId: string,
  spaceId: string,
  hint: string | null,
): Promise<string | null> {
  if (!hint) return null;
  return asUser(userId, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      select p.id
      from orbit.space_members m
      join orbit.profiles p on p.id = m.user_id
      where m.space_id = ${spaceId}::uuid
        and m.status = 'active'
        and m.role in ('owner','admin','member')
        and (lower(p.display_name) = ${hint}
             or lower(split_part(p.display_name, ' ', 1)) = ${hint})
      limit 1
    `;
    return row?.id ?? null;
  });
}

/**
 * Create whatever the line described.
 *
 * One row, in one space, through `asUser`. A capture with no title creates
 * nothing — a task called "tomorrow" is not what anybody meant by typing a date
 * on its own.
 */
export async function createFromCapture(
  userId: string,
  text: string,
  target: CaptureTarget,
  today?: string,
): Promise<Created | { error: string }> {
  const capture = parseCapture(text, today ? { today } : undefined);
  const kind = target.kind ?? capture.kind;

  if (!capture.title) {
    return { error: 'There is nothing here but a date. Type what it is as well.' };
  }
  if (!target.spaceId) {
    return { error: 'Pick a space. What you capture is readable by everyone in it.' };
  }

  const assigneeId = await resolveAssignee(userId, target.spaceId, capture.assigneeHint);

  if (kind === 'note') {
    return asUser(userId, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into orbit.notes (space_id, owner_id, title, body_md)
        values (${target.spaceId}::uuid, ${userId}::uuid, ${capture.title}, '')
        returning id
      `;
      return { kind: 'note' as const, id: row.id, href: `/notes/${row.id}` };
    });
  }

  if (kind === 'event') {
    const instants = captureInstants(capture);
    // An event with no date at all is a task somebody has mislabelled; it is
    // created as one rather than refused, because refusing loses the typing.
    if (instants) {
      return asUser(userId, async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          insert into orbit.events
            (space_id, owner_id, calendar_id, title, starts_at, ends_at, all_day)
          values (
            ${target.spaceId}::uuid, ${userId}::uuid,
            (select c.id from orbit.calendars c
              where c.space_id = ${target.spaceId}::uuid and c.is_writable
              order by c.sort_order, c.name limit 1),
            ${capture.title}, ${instants.startsAt}, ${instants.endsAt}, ${instants.allDay})
          returning id
        `;
        return { kind: 'event' as const, id: row.id, href: `/calendar/event/${row.id}` };
      });
    }
  }

  return asUser(userId, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into orbit.tasks
        (space_id, owner_id, title, due_on, priority, assignee_id)
      values (
        ${target.spaceId}::uuid, ${userId}::uuid, ${capture.title},
        ${capture.date}::date,
        ${capture.priority ?? 'normal'}::orbit.priority,
        ${assigneeId ?? userId}::uuid)
      returning id
    `;
    return { kind: 'task' as const, id: row.id, href: `/tasks/item/${row.id}` };
  });
}
