import 'server-only';
import { asUser, type Tx } from '@/lib/db';
import type { SpaceRef } from '@/components/SpaceIndicator';
import {
  applyChoice,
  changedFields,
  planQueue,
  rebase,
  resolveWrite,
  SYNC_ENTITY_KINDS,
  type Conflict,
  type ConflictChoice,
  type FieldValue,
  type PendingWrite,
  type Resolution,
  type ServerRow,
  type SyncEntityKind,
} from '@/lib/sync/conflict';

/**
 * Sync — the database side.
 *
 * What may happen when two edits meet is pure and lives in
 * `src/lib/sync/conflict.ts`. This module does the three things it cannot:
 * read the cursor, read what changed since it, and apply a queued write.
 *
 * **A queued write is still a write.** It goes through `asUser` like every
 * other one — there is no elevated path for catching up, and a write to a
 * space the caller left while offline is refused by the same policy that would
 * have refused it online. That is the whole reason the applier reads the row
 * and writes it inside one transaction as the *user*, rather than resolving
 * against a snapshot fetched earlier by somebody else.
 *
 * The read-then-write is a single transaction for the ordinary reason: between
 * reading the row and writing it, somebody else's write must not slip in
 * unseen. `select ... for update` takes the row lock so the version the
 * resolution was computed against is the version being replaced.
 */

// ---------------------------------------------------------------------------
// Which columns a queued write may touch
//
// A closed list, per kind, for the same reason the rules engine's condition
// fields are closed: an open list means a typo becomes a column nobody has,
// and the failure arrives as a database error at flush time — offline, on
// somebody else's device. It also means a queued write can never reach
// `space_id`, `owner_id` or `is_locked`, which are not edits, they are moves
// and grants, and each has its own confirmed path.
// ---------------------------------------------------------------------------

export const SYNCABLE_FIELDS: Record<SyncEntityKind, readonly string[]> = {
  task: ['title', 'body_md', 'status', 'priority', 'due_on', 'waiting_on'],
  note: ['title', 'body_md'],
  event: ['title', 'location_text', 'body_md'],
  person: ['display_name', 'notes_md'],
  place: ['name', 'notes_md'],
};

const TABLE: Record<SyncEntityKind, string> = {
  task: 'tasks',
  note: 'notes',
  event: 'events',
  person: 'people',
  place: 'places',
};

/** The column each kind shows as its name. Used by the change feed only. */
const TITLE_COLUMN: Record<SyncEntityKind, string> = {
  task: 'title',
  note: 'title',
  event: 'title',
  person: 'display_name',
  place: 'name',
};

export function isSyncableField(kind: SyncEntityKind, field: string): boolean {
  return SYNCABLE_FIELDS[kind].includes(field);
}

// ---------------------------------------------------------------------------
// Cursors
// ---------------------------------------------------------------------------

export type DeviceRow = {
  id: string;
  label: string;
  platform: string;
  spaceId: string;
  space: SpaceRef;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

/**
 * The caller's devices.
 *
 * No `where owner_id =`: `devices` carries the standard space-wide policy, so
 * a partner's device in a shared space is legitimately visible — which is the
 * point, because a cursor that only its own device could see would make "this
 * space is three days behind on that laptop" unanswerable. Ownership is shown
 * on the row instead of being filtered away.
 */
export async function listDevices(userId: string): Promise<DeviceRow[]> {
  return asUser(userId, async (tx) => {
    return tx<DeviceRow[]>`
      select
        d.id, d.label, d.platform,
        d.space_id      as "spaceId",
        d.last_seen_at  as "lastSeenAt",
        d.revoked_at    as "revokedAt",
        jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                           'colour', s.colour, 'icon', s.icon) as space
      from orbit.devices d
      join orbit.spaces s on s.id = d.space_id
      where d.owner_id = ${userId}::uuid
      order by s.name, d.label
    `;
  });
}

export type CursorRow = {
  id: string;
  deviceId: string;
  deviceLabel: string;
  spaceId: string;
  space: SpaceRef;
  entityKind: SyncEntityKind;
  cursorAt: string;
  lastSyncAt: string | null;
};

export async function listCursors(userId: string): Promise<CursorRow[]> {
  return asUser(userId, async (tx) => {
    return tx<CursorRow[]>`
      select
        c.id,
        c.device_id     as "deviceId",
        d.label         as "deviceLabel",
        c.space_id      as "spaceId",
        c.entity_kind::text as "entityKind",
        c.cursor_at     as "cursorAt",
        c.last_sync_at  as "lastSyncAt",
        jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                           'colour', s.colour, 'icon', s.icon) as space
      from orbit.sync_cursors c
      join orbit.devices d on d.id = c.device_id
      join orbit.spaces  s on s.id = c.space_id
      order by s.name, d.label, c.entity_kind
    `;
  });
}

export type ChangeRow = {
  entityKind: SyncEntityKind;
  entityId: string;
  title: string;
  updatedAt: string;
  isLocked: boolean;
  spaceId: string;
  space: SpaceRef;
};

/**
 * What has changed in a space since a cursor.
 *
 * One query per kind rather than a `union all`, for the same reason search is
 * five queries: each table names its title differently and flattening them
 * would either lose that or carry five nullable columns nobody reads.
 *
 * A locked row is *listed* — it has an id and an `updated_at`, and a device
 * that does not know it changed cannot ever fetch its ciphertext — but its
 * title is empty by constraint, so the feed shows a locked row as locked
 * rather than as a row with a missing name.
 */
export async function changesSince(
  userId: string,
  spaceId: string,
  since: string,
  limit = 50,
): Promise<ChangeRow[]> {
  return asUser(userId, async (tx) => {
    const out: ChangeRow[] = [];
    for (const kind of SYNC_ENTITY_KINDS) {
      const rows = await tx<Omit<ChangeRow, 'entityKind'>[]>`
        select
          e.id            as "entityId",
          ${tx.unsafe(`e.${TITLE_COLUMN[kind]}`)} as title,
          e.updated_at    as "updatedAt",
          e.is_locked     as "isLocked",
          e.space_id      as "spaceId",
          jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                             'colour', s.colour, 'icon', s.icon) as space
        from ${tx.unsafe(`orbit.${TABLE[kind]}`)} e
        join orbit.spaces s on s.id = e.space_id
        where e.space_id = ${spaceId}::uuid
          and e.updated_at > ${since}::timestamptz
        order by e.updated_at desc
        limit ${limit}
      `;
      for (const r of rows) out.push({ ...r, entityKind: kind });
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  });
}

/**
 * Move a cursor forward, and never backward.
 *
 * `greatest(cursor_at, excluded)` is not defensive dressing: two tabs flushing
 * the same device's queue can arrive out of order, and a cursor that went
 * backwards would re-deliver everything between the two — which for a device
 * that is *catching up* is the difference between a quiet sync and a full
 * re-download. The write is an upsert because the first sync of a new kind on
 * a new device has no row yet.
 */
export async function advanceCursor(
  userId: string,
  spaceId: string,
  deviceId: string,
  entityKind: SyncEntityKind,
  cursorAt: string,
): Promise<void> {
  await asUser(userId, async (tx) => {
    await tx`
      insert into orbit.sync_cursors (space_id, owner_id, device_id, entity_kind, cursor_at, last_sync_at)
      values (${spaceId}::uuid, ${userId}::uuid, ${deviceId}::uuid, ${entityKind}::orbit.entity_kind,
              ${cursorAt}::timestamptz, now())
      on conflict (space_id, device_id, entity_kind) do update
        set cursor_at    = greatest(orbit.sync_cursors.cursor_at, excluded.cursor_at),
            last_sync_at = now()
    `;
  });
}

/** Wind every cursor for a device in a space back to the epoch. */
export async function resetCursors(userId: string, spaceId: string, deviceId: string): Promise<number> {
  return asUser(userId, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      update orbit.sync_cursors
         set cursor_at = 'epoch'::timestamptz
       where space_id = ${spaceId}::uuid and device_id = ${deviceId}::uuid
      returning id
    `;
    return rows.length;
  });
}

// ---------------------------------------------------------------------------
// Applying a queued write
// ---------------------------------------------------------------------------

export type ApplyOutcome = Resolution & {
  /** Filled in once the write has actually gone in, so the page can say the new base. */
  newUpdatedAt?: string;
};

export type FlushResult = {
  results: ApplyOutcome[];
  droppedDuplicates: string[];
  conflicts: Conflict[];
  /** The server's clock at the moment of the flush. The device compares itself to it. */
  serverNow: string;
};

/**
 * Flush a queue of writes, in order, one transaction each.
 *
 * One transaction per write rather than one for the lot, deliberately: a
 * conflict on the third of five must not roll back the two that landed. A
 * queue is a list of independent edits somebody made, not a unit of work they
 * intended to be atomic — and telling them "none of your five edits applied
 * because one of them clashed" would be a lie about four of them.
 */
export async function flushQueue(userId: string, writes: readonly PendingWrite[]): Promise<FlushResult> {
  const plan = planQueue(writes);
  const results: ApplyOutcome[] = [];
  const conflicts: Conflict[] = [];

  let pending = plan.ordered;
  for (let i = 0; i < pending.length; i += 1) {
    const write = pending[i]!;
    const outcome = await applyWrite(userId, write);
    results.push(outcome);
    if (outcome.outcome === 'conflict') conflicts.push(outcome.conflict);

    // Fold what just landed into every later write on the same row, so a
    // device never conflicts with itself. See `rebase` in the pure module.
    if (outcome.newUpdatedAt && (outcome.outcome === 'apply' || outcome.outcome === 'merge')) {
      const applied = outcome.apply;
      const at = outcome.newUpdatedAt;
      pending = pending.map((w, j) =>
        j > i && w.entityKind === write.entityKind && w.entityId === write.entityId
          ? rebase(w, write.opId, applied, at)
          : w,
      );
    }
  }

  const [{ now }] = await asUser(userId, async (tx) => tx<{ now: string }[]>`select now() as now`);
  return { results, droppedDuplicates: plan.droppedDuplicates, conflicts, serverNow: now };
}

/**
 * One queued write, resolved and applied inside one transaction as the user.
 *
 * The row is read `for update` and written in the same transaction, so the
 * version the resolution was computed against is the version being replaced.
 * Without the lock, two devices flushing at once could both read the same
 * `updated_at`, both decide they had a clean apply, and the second would
 * overwrite the first with neither of them ever seeing a conflict — which is
 * exactly the silent loss this whole module exists to prevent.
 */
export async function applyWrite(userId: string, write: PendingWrite): Promise<ApplyOutcome> {
  const fields = SYNCABLE_FIELDS[write.entityKind];
  for (const f of Object.keys(write.changes)) {
    if (!fields.includes(f)) {
      throw new Error(`${f} is not a syncable field on a ${write.entityKind}`);
    }
  }

  return asUser(userId, async (tx) => {
    const cols = fields.map((f) => `e.${f}`).join(', ');
    const rows = await tx<Record<string, FieldValue>[]>`
      select e.id, e.updated_at as "updatedAt", e.is_locked as "isLocked",
             e.space_id as "spaceId", ${tx.unsafe(cols)}
      from ${tx.unsafe(`orbit.${TABLE[write.entityKind]}`)} e
      where e.id = ${write.entityId}::uuid
      for update
    `;

    const server: ServerRow = rows[0]
      ? {
          exists: true,
          updatedAt: String(rows[0].updatedAt),
          isLocked: rows[0].isLocked === true,
          spaceId: String(rows[0].spaceId),
          fields: Object.fromEntries(fields.map((f) => [f, rows[0]![f] ?? null])),
        }
      : { exists: false };

    const resolution = resolveWrite(write, server);
    if (resolution.outcome === 'conflict') return resolution;
    const apply = resolution.apply as Record<string, FieldValue>;
    if (Object.keys(apply).length === 0) return resolution;

    const newUpdatedAt = await writeFields(tx, write.entityKind, write.entityId, apply);
    // A row that vanished between the read and the write cannot happen under
    // the lock; a row the *policy* refuses to update can, and returns nothing.
    if (newUpdatedAt === null) {
      return {
        outcome: 'conflict',
        opId: write.opId,
        conflict: {
          kind: 'deleted_elsewhere',
          opId: write.opId,
          entityKind: write.entityKind,
          entityId: write.entityId,
          spaceId: write.spaceId,
          clashes: [],
          mergeable: {},
          reason:
            'That write was refused — the item is gone, or it is in a space this account can no longer write to. Nothing has been written.',
        },
      };
    }
    return { ...resolution, newUpdatedAt };
  });
}

/**
 * Answer a conflict: write the fields the choice implies, against the version
 * the person was just shown.
 *
 * The choice does not bypass anything. It becomes an ordinary write with a
 * fresh base, so if the row moved *again* between reading the conflict and
 * answering it, the answer conflicts in its turn rather than silently landing
 * on top of a third edit nobody has seen.
 */
export async function resolveConflictWrite(
  userId: string,
  conflict: Conflict,
  choice: ConflictChoice,
  currentUpdatedAt: string,
): Promise<ApplyOutcome> {
  const apply = applyChoice(conflict, choice);
  if (Object.keys(apply).length === 0) {
    return { outcome: 'noop', opId: conflict.opId, apply: {}, note: 'Nothing to write for that answer.' };
  }
  const base: Record<string, FieldValue> = {};
  for (const c of conflict.clashes) base[c.field] = choice === 'mine' ? c.theirs : c.mine;
  for (const f of Object.keys(conflict.mergeable)) if (!(f in base)) base[f] = null;

  return applyWrite(userId, {
    opId: conflict.opId,
    entityKind: conflict.entityKind,
    entityId: conflict.entityId,
    spaceId: conflict.spaceId,
    label: 'Conflict answered',
    baseUpdatedAt: currentUpdatedAt,
    changes: apply,
    base,
    queuedAt: new Date().toISOString(),
    seq: 0,
  });
}

/** Read the values a write's fields hold right now, so a client can rebase on them. */
export async function readCurrent(
  userId: string,
  kind: SyncEntityKind,
  entityId: string,
): Promise<{ updatedAt: string; fields: Record<string, FieldValue>; isLocked: boolean } | null> {
  const fields = SYNCABLE_FIELDS[kind];
  return asUser(userId, async (tx) => {
    const cols = fields.map((f) => `e.${f}`).join(', ');
    const rows = await tx<Record<string, FieldValue>[]>`
      select e.updated_at as "updatedAt", e.is_locked as "isLocked", ${tx.unsafe(cols)}
      from ${tx.unsafe(`orbit.${TABLE[kind]}`)} e
      where e.id = ${entityId}::uuid
    `;
    if (!rows[0]) return null;
    return {
      updatedAt: String(rows[0].updatedAt),
      isLocked: rows[0].isLocked === true,
      fields: Object.fromEntries(fields.map((f) => [f, rows[0]![f] ?? null])),
    };
  });
}

/**
 * The `update` itself, built from a closed field list.
 *
 * The column names are interpolated with `tx.unsafe`, which is exactly the
 * shape that would be an injection if the list were open. It is not: every
 * name comes from `SYNCABLE_FIELDS`, checked against it in `applyWrite`
 * before this is reached. The *values* are bound parameters throughout.
 */
async function writeFields(
  tx: Tx,
  kind: SyncEntityKind,
  entityId: string,
  apply: Record<string, FieldValue>,
): Promise<string | null> {
  const names = Object.keys(apply).filter((f) => SYNCABLE_FIELDS[kind].includes(f));
  if (names.length === 0) return null;

  const assignments = names.map((f, i) => `${f} = $${i + 1}`).join(', ');
  const values = names.map((f) => apply[f] ?? null);
  const rows = await tx.unsafe<{ updatedAt: string }[]>(
    `update orbit.${TABLE[kind]} set ${assignments}
       where id = $${names.length + 1}::uuid
     returning updated_at as "updatedAt"`,
    [...values, entityId] as never[],
  );
  return rows[0]?.updatedAt ?? null;
}

/** Turn a change feed row's fields into the base a client edit should carry. */
export function baseFor(kind: SyncEntityKind, row: Record<string, FieldValue>): Record<string, FieldValue> {
  return Object.fromEntries(SYNCABLE_FIELDS[kind].map((f) => [f, row[f] ?? null]));
}

export { changedFields, SYNC_ENTITY_KINDS };
export type { PendingWrite, Conflict, ConflictChoice, SyncEntityKind };
