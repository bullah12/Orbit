/**
 * Sync — the pure half: what happens when two edits meet.
 *
 * Nothing here touches the database, the network or the clock. It is given a
 * queued write and the row as the server holds it now, and it says what should
 * happen. Same shape as the rules evaluator and the AI gate, and for the same
 * reason: a merge rule that lives in a page is a merge rule the next page
 * forgets, and this is the one place in Orbit where forgetting it silently
 * loses somebody's typing.
 *
 * ## The decisions, stated
 *
 * **1. There is no last-write-wins.** Two people editing the same field to
 * different values is a question only a person can answer, so the write is
 * *held* as a named conflict and neither value is thrown away. A silent
 * last-write-wins would be a decision too — this is the other one, made on
 * purpose, because the loser of a silent race never finds out.
 *
 * **2. A write carries fields, not rows.** A queued edit records only the
 * fields somebody changed, plus what each held when they changed it. That is
 * what makes the common case — she retitled it, he set the due date — a merge
 * rather than a fight. A whole-row write would make every concurrent edit a
 * conflict and teach people to click through the dialog.
 *
 * **3. The client clock never orders anything.** Devices disagree, and an
 * offline device disagrees most. Ordering across devices is decided by the
 * server's `updated_at` alone; `queuedAt` orders a queue against *itself* and
 * is otherwise only ever displayed. {@link clockSkew} exists to *report* a
 * disagreeing clock, never to correct for one.
 *
 * **4. A replay is not a conflict.** The same write arriving twice — retry,
 * refresh, two tabs — finds the server already holding the value it wanted.
 * That is `duplicate`, not `conflict`: the row is already what the person
 * asked for. This is what makes the queue safe to flush again after a failure
 * with no idempotency table anywhere.
 *
 * **5. A deleted row is never resurrected**, and a row that became locked
 * since the edit is never written to in plaintext. Both are conflicts with
 * their own name, because "your edit was applied" and "your edit went nowhere"
 * must not look the same.
 */

/** The values a queued write can carry. Enough for every field a form edits. */
export type FieldValue = string | number | boolean | null;

export const SYNC_ENTITY_KINDS = ['task', 'note', 'event', 'person', 'place'] as const;
export type SyncEntityKind = (typeof SYNC_ENTITY_KINDS)[number];

export function isSyncEntityKind(v: unknown): v is SyncEntityKind {
  return typeof v === 'string' && (SYNC_ENTITY_KINDS as readonly string[]).includes(v);
}

/**
 * One edit, made on a device against a version of a row it had read.
 *
 * `base` is not redundant with `baseUpdatedAt`: the timestamp says *whether*
 * the server moved, and `base` says whether the move actually touched anything
 * this write cares about.
 */
export type PendingWrite = {
  /** Client-generated and stable across retries. Two deliveries of one edit share it. */
  opId: string;
  entityKind: SyncEntityKind;
  entityId: string;
  /** The space the edit was made in. Carried so every pending surface can show the indicator. */
  spaceId: string;
  /** A short human sentence for the pending row. Display only. */
  label: string;
  /** The row's server `updated_at` when the edit was made. Null means "created offline". */
  baseUpdatedAt: string | null;
  /** Only the fields that were actually changed. */
  changes: Record<string, FieldValue>;
  /** What each of those fields held on the base version. */
  base: Record<string, FieldValue>;
  /** The device's clock when queued. Orders this queue against itself; never against another device. */
  queuedAt: string;
  /** Monotonic within one device's queue. The actual ordering key. */
  seq: number;
};

/** The row as the server holds it now, read in the same transaction that will write. */
export type ServerRow =
  | {
      exists: true;
      updatedAt: string;
      /** Only the fields a write might touch need be present. */
      fields: Record<string, FieldValue>;
      isLocked: boolean;
      /** Where the row lives *now*, which is not always where the edit was made. */
      spaceId: string;
    }
  | { exists: false };

export type ConflictKind =
  | 'field_conflict'
  | 'deleted_elsewhere'
  | 'locked_elsewhere'
  | 'moved_space';

/** One field both sides changed, with both values kept. */
export type FieldClash = {
  field: string;
  /** What was typed here. */
  mine: FieldValue;
  /** What the server holds. */
  theirs: FieldValue;
  /** What both started from. */
  base: FieldValue;
};

export type Conflict = {
  kind: ConflictKind;
  opId: string;
  entityKind: SyncEntityKind;
  entityId: string;
  spaceId: string;
  /** Empty for every kind but `field_conflict`. */
  clashes: FieldClash[];
  /** Fields that merged cleanly and are waiting on the clash being answered. */
  mergeable: Record<string, FieldValue>;
  /** One sentence naming what happened. Shown as-is. */
  reason: string;
};

export type Resolution =
  /** Nothing moved underneath it. Apply as typed. */
  | { outcome: 'apply'; opId: string; apply: Record<string, FieldValue>; note: null }
  /** The server moved, but not on any field this write touched. Both edits survive. */
  | {
      outcome: 'merge';
      opId: string;
      apply: Record<string, FieldValue>;
      /** Fields the other side changed while this was queued. Display only. */
      theirFields: string[];
      note: string;
    }
  /** The server already holds every value this write asked for. */
  | { outcome: 'duplicate'; opId: string; apply: Record<string, never>; note: string }
  /** The write changed nothing in the first place. */
  | { outcome: 'noop'; opId: string; apply: Record<string, never>; note: string }
  | { outcome: 'conflict'; opId: string; conflict: Conflict };

/** Two field values, compared the way a form would. */
export function sameValue(a: FieldValue, b: FieldValue): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  return a === b;
}

const REASON: Record<ConflictKind, string> = {
  field_conflict:
    'Somebody else changed the same thing while this edit was waiting. Both versions are here; nothing has been overwritten.',
  deleted_elsewhere:
    'That item was deleted elsewhere while this edit was waiting. Nothing has been written — a deleted row is never brought back by an edit that did not know it was gone.',
  locked_elsewhere:
    'That item was locked while this edit was waiting. A locked item has no plaintext on this server, so a plaintext edit cannot be applied to it.',
  moved_space:
    'That item was moved to another space while this edit was waiting. An edit made in one space is not applied in another.',
};

/**
 * What should happen to one queued write, given the row as the server holds it.
 *
 * The order of the checks is deliberate and is asserted in the tests. Gone,
 * locked and moved are decided *before* any field is compared, because all
 * three make the field comparison meaningless — and because a locked row's
 * fields are empty by constraint, so comparing them would read as "they
 * cleared the title", which is the most misleading possible answer.
 */
export function resolveWrite(write: PendingWrite, server: ServerRow): Resolution {
  const changed = changedFields(write);

  if (!server.exists) {
    return conflict(write, 'deleted_elsewhere', [], {});
  }
  if (server.isLocked) {
    return conflict(write, 'locked_elsewhere', [], {});
  }
  if (server.spaceId !== write.spaceId) {
    return conflict(write, 'moved_space', [], {});
  }

  if (changed.length === 0) {
    return { outcome: 'noop', opId: write.opId, apply: {}, note: 'That edit changed nothing.' };
  }

  // Everything asked for is already true. A retry, a second tab, or the same
  // edit made twice — never a conflict, because the row is already what the
  // person wanted it to be.
  const alreadyThere = changed.every((f) => sameValue(server.fields[f] ?? null, write.changes[f] ?? null));
  if (alreadyThere) {
    const moved = write.baseUpdatedAt !== null && server.updatedAt !== write.baseUpdatedAt;
    return {
      outcome: 'duplicate',
      opId: write.opId,
      apply: {},
      note: moved
        ? 'Already applied — the server holds exactly this. Nothing was written twice.'
        : 'Nothing to do — the row already says that.',
    };
  }

  const untouched = write.baseUpdatedAt !== null && server.updatedAt === write.baseUpdatedAt;
  if (untouched) {
    return { outcome: 'apply', opId: write.opId, apply: pick(write.changes, changed), note: null };
  }

  // The server moved. Whether that matters depends on *which* fields moved,
  // which is the whole reason a write carries its base values.
  const clashes: FieldClash[] = [];
  const mergeable: Record<string, FieldValue> = {};
  const theirFields: string[] = [];

  for (const field of changed) {
    const mine = write.changes[field] ?? null;
    const theirs = server.fields[field] ?? null;
    const base = write.base[field] ?? null;

    if (sameValue(theirs, base)) {
      // They did not touch this field. Mine lands.
      mergeable[field] = mine;
      continue;
    }
    if (sameValue(theirs, mine)) {
      // They arrived at the same value. Not a clash; nothing left to write.
      continue;
    }
    theirFields.push(field);
    clashes.push({ field, mine, theirs, base });
  }

  if (clashes.length > 0) {
    return conflict(write, 'field_conflict', clashes, mergeable);
  }

  return {
    outcome: 'merge',
    opId: write.opId,
    apply: mergeable,
    theirFields,
    note: mergedSentence(changed, mergeable),
  };
}

function mergedSentence(changed: string[], mergeable: Record<string, FieldValue>): string {
  const landed = Object.keys(mergeable);
  if (landed.length === changed.length) {
    return 'Merged — the item changed elsewhere while this was waiting, but not on anything this edit touched.';
  }
  if (landed.length === 0) {
    return 'Merged — everything this edit asked for had already been done elsewhere.';
  }
  return `Merged — ${landed.length} of ${changed.length} changes applied; the rest had already been made elsewhere.`;
}

function conflict(
  write: PendingWrite,
  kind: ConflictKind,
  clashes: FieldClash[],
  mergeable: Record<string, FieldValue>,
): Resolution {
  return {
    outcome: 'conflict',
    opId: write.opId,
    conflict: {
      kind,
      opId: write.opId,
      entityKind: write.entityKind,
      entityId: write.entityId,
      spaceId: write.spaceId,
      clashes,
      mergeable,
      reason: REASON[kind],
    },
  };
}

/** The fields this write actually alters, ignoring ones re-set to what they were. */
export function changedFields(write: PendingWrite): string[] {
  return Object.keys(write.changes)
    .filter((f) => !sameValue(write.changes[f] ?? null, write.base[f] ?? null))
    .sort();
}

function pick(src: Record<string, FieldValue>, fields: string[]): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const f of fields) out[f] = src[f] ?? null;
  return out;
}

// ---------------------------------------------------------------------------
// Answering a conflict
// ---------------------------------------------------------------------------

export type ConflictChoice = 'mine' | 'theirs';

/**
 * What to write once a person has answered a `field_conflict`.
 *
 * `theirs` is not "discard": it still applies the fields that merged cleanly,
 * because those were never in dispute. Keeping the other side's value for the
 * one field that was does not mean throwing away the due date nobody argued
 * about.
 *
 * Every kind but `field_conflict` returns nothing to write. There is no answer
 * to "it was deleted" that this module can carry out — recreating it is a new
 * write, made deliberately, with its own base.
 */
export function applyChoice(conflict: Conflict, choice: ConflictChoice): Record<string, FieldValue> {
  if (conflict.kind !== 'field_conflict') return {};
  const out: Record<string, FieldValue> = { ...conflict.mergeable };
  if (choice === 'mine') {
    for (const c of conflict.clashes) out[c.field] = c.mine;
  }
  return out;
}

// ---------------------------------------------------------------------------
// A queue, not a write
// ---------------------------------------------------------------------------

export type QueuePlan = {
  /** In the order they must be sent. */
  ordered: PendingWrite[];
  /** opIds dropped because the same op was queued twice. */
  droppedDuplicates: string[];
};

/**
 * Put a device's queue in order, and drop an op that was queued twice.
 *
 * Ordered by `seq`, which is the device's own counter, with `queuedAt` only as
 * a tie-break — and a tie-break is the *only* thing a client clock is allowed
 * to decide (decision 3). Two devices' queues are never interleaved here: each
 * flushes its own, and the server's `updated_at` is what makes the second one
 * see the first one's work.
 */
export function planQueue(writes: readonly PendingWrite[]): QueuePlan {
  const seen = new Set<string>();
  const droppedDuplicates: string[] = [];
  const ordered = [...writes]
    .sort((a, b) => (a.seq === b.seq ? a.queuedAt.localeCompare(b.queuedAt) : a.seq - b.seq))
    .filter((w) => {
      if (seen.has(w.opId)) {
        droppedDuplicates.push(w.opId);
        return false;
      }
      seen.add(w.opId);
      return true;
    });
  return { ordered, droppedDuplicates };
}

/**
 * Fold an applied write into the base a later write in the same queue holds.
 *
 * Two edits to one row from one device are not a conflict with each other, and
 * without this they would look like one: the second still carries the base it
 * read before the first was sent, so the server would appear to have "moved"
 * underneath it — by its own hand. Rebasing makes the second edit's base what
 * the first edit actually left behind.
 */
export function rebase(
  later: PendingWrite,
  appliedOpId: string,
  applied: Record<string, FieldValue>,
  newUpdatedAt: string,
): PendingWrite {
  if (later.opId === appliedOpId) return later;
  const base = { ...later.base };
  for (const [field, value] of Object.entries(applied)) {
    if (field in base) base[field] = value;
  }
  return { ...later, base, baseUpdatedAt: newUpdatedAt };
}

// ---------------------------------------------------------------------------
// Clocks
// ---------------------------------------------------------------------------

export type ClockReport = {
  /** Device minus server, in seconds. Positive means the device is ahead. */
  skewSeconds: number;
  /** Over a minute out. Worth saying on screen; never worth correcting for. */
  isSuspicious: boolean;
  sentence: string;
};

/**
 * Say how far apart two clocks are. Nothing acts on this.
 *
 * It exists so that "queued 10 minutes ago" reading as "queued in 3 hours"
 * has an explanation on the screen rather than looking like a bug in the
 * queue. Ordering never consults it — see decision 3.
 */
export function clockSkew(deviceNow: string, serverNow: string): ClockReport {
  const skewSeconds = Math.round((Date.parse(deviceNow) - Date.parse(serverNow)) / 1000);
  const isSuspicious = Math.abs(skewSeconds) > 60;
  const abs = Math.abs(skewSeconds);
  const magnitude =
    abs < 60 ? `${abs} seconds` : abs < 3600 ? `${Math.round(abs / 60)} minutes` : `${(abs / 3600).toFixed(1)} hours`;
  return {
    skewSeconds,
    isSuspicious,
    sentence: !isSuspicious
      ? 'This device’s clock agrees with the server.'
      : skewSeconds > 0
        ? `This device’s clock is ${magnitude} ahead of the server. Times on queued edits will read late; nothing is ordered by them.`
        : `This device’s clock is ${magnitude} behind the server. Times on queued edits will read early; nothing is ordered by them.`,
  };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export const OUTCOME_LABEL: Record<Resolution['outcome'], string> = {
  apply: 'Applied',
  merge: 'Merged',
  duplicate: 'Already applied',
  noop: 'Nothing to do',
  conflict: 'Conflict',
};

export const CONFLICT_LABEL: Record<ConflictKind, string> = {
  field_conflict: 'Changed in two places',
  deleted_elsewhere: 'Deleted elsewhere',
  locked_elsewhere: 'Locked elsewhere',
  moved_space: 'Moved to another space',
};

/** Field names as a person would read them. Unknown fields fall back to the column. */
export const FIELD_LABEL: Record<string, string> = {
  title: 'Title',
  body_md: 'Body',
  status: 'Status',
  priority: 'Priority',
  due_on: 'Due date',
  waiting_on: 'Waiting on',
  estimate_minutes: 'Estimate',
  starts_at: 'Starts',
  ends_at: 'Ends',
  location_text: 'Location',
  notes_md: 'Notes',
  display_name: 'Name',
};

export function fieldLabel(field: string): string {
  return FIELD_LABEL[field] ?? field;
}

/** A value as a person would read it in a conflict row. */
export function displayValue(v: FieldValue): string {
  if (v === null || v === '') return '—';
  if (v === true) return 'yes';
  if (v === false) return 'no';
  return String(v);
}
