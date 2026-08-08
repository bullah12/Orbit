/**
 * The outbox — a device's queue of writes it has not sent yet.
 *
 * Pure functions over a plain object, plus two thin `localStorage` wrappers.
 * Kept out of the component so the interesting parts — the sequence number,
 * what happens when one row is edited twice before either is sent, and what a
 * flush result does to the queue — can be tested without a browser.
 *
 * `localStorage` rather than IndexedDB, deliberately: a queue of a few edits is
 * kilobytes, and IndexedDB here would buy asynchrony we do not need at the cost
 * of a schema migration nobody would ever run. `localStorage` is also what
 * makes the queue survive a reload, which is the only durability an offline
 * edit actually needs before it is sent.
 *
 * There is no service worker. Orbit cannot install one in this container
 * without a build pipeline it does not have, so "offline" here is a switch
 * somebody flicks rather than a network the browser noticed going away — and
 * the page says so, in those words, rather than implying a capability that is
 * not there.
 */

import type { Conflict, PendingWrite, SyncEntityKind } from './conflict';

export const OUTBOX_KEY = 'orbit.outbox.v1';
export const OFFLINE_KEY = 'orbit.offline.v1';

export type Outbox = {
  writes: PendingWrite[];
  conflicts: Conflict[];
  /**
   * The edit behind each unanswered conflict, by `opId`.
   *
   * Edge 7, first half. `settle` takes a conflicted write *out* of `writes` —
   * correctly, because it is no longer waiting to be sent — and until session
   * 12 that was the last anybody saw of it. For a `field_conflict` the typed
   * values survived inside `clashes[].mine`, but `clashes` is empty for every
   * other kind, so a `deleted_elsewhere`, `locked_elsewhere` or `moved_space`
   * conflict discarded the person's typing the moment it was raised — before
   * they had touched anything.
   *
   * Holding the write here is what makes the record possible at all, and what
   * makes putting it back possible.
   */
  held: Record<string, PendingWrite>;
  /**
   * Dismissed conflicts, with the edit that was discarded. Edge 7, second half.
   *
   * Dismissing used to delete the conflict and with it the only copy of the
   * edit. It now moves it here, where `/sync` lists it and can put it back.
   * Capped, oldest dropped first — this is a safety net, not an archive, and an
   * unbounded list in `localStorage` eventually fails to save the queue itself.
   */
  discarded: DiscardedEdit[];
  /** Next sequence number for this device. Monotonic, never reused. */
  nextSeq: number;
};

/** One dismissed conflict, kept whole so it can be read back or restored. */
export type DiscardedEdit = {
  conflict: Conflict;
  /** The edit exactly as it was queued, or null if it was already gone. */
  write: PendingWrite | null;
  /** This device's clock. Displayed, never used to order anything. */
  discardedAt: string;
};

/**
 * How many dismissed edits are kept.
 *
 * `localStorage` is a few megabytes and shared with the queue. A discard log
 * that grew without limit would eventually be the reason an edit could not be
 * saved, which would be this feature causing the loss it exists to prevent.
 */
export const DISCARD_LIMIT = 50;

export const EMPTY_OUTBOX: Outbox = {
  writes: [],
  conflicts: [],
  held: {},
  discarded: [],
  nextSeq: 1,
};

/** One flush's answer, in the shape the queue needs to act on it. */
export type FlushOutcome = {
  opId: string;
  outcome: 'apply' | 'merge' | 'duplicate' | 'noop' | 'conflict';
  note: string | null;
  conflict: Conflict | null;
};

/**
 * Add a write, giving it this device's next sequence number.
 *
 * Two edits to the same field of the same row are *not* collapsed. It is
 * tempting — the second supersedes the first — but collapsing them means the
 * base of the surviving write is the base of the *first*, so a merge would be
 * computed against a version the person never saw. They are chained instead,
 * and `flushQueue` rebases the second onto whatever the first left behind.
 */
export function enqueue(
  outbox: Outbox,
  write: Omit<PendingWrite, 'seq' | 'opId' | 'queuedAt'> & { opId?: string; queuedAt?: string },
): Outbox {
  const full: PendingWrite = {
    ...write,
    opId: write.opId ?? newOpId(),
    queuedAt: write.queuedAt ?? new Date().toISOString(),
    seq: outbox.nextSeq,
  };
  return { ...outbox, writes: [...outbox.writes, full], nextSeq: outbox.nextSeq + 1 };
}

/**
 * Apply a flush's answers to the queue.
 *
 * Everything that landed — applied, merged, already applied, nothing to do —
 * leaves the queue. A conflict leaves the queue too, and arrives in
 * `conflicts`: it is no longer *waiting to be sent*, it is waiting to be
 * answered, and a queue that kept re-sending a write nobody had answered would
 * ask the same question on every flush.
 */
export function settle(outbox: Outbox, outcomes: readonly FlushOutcome[], dropped: readonly string[] = []): Outbox {
  const handled = new Set([...outcomes.map((o) => o.opId), ...dropped]);
  const newConflicts = outcomes
    .filter((o) => o.outcome === 'conflict' && o.conflict)
    .map((o) => o.conflict!);
  const keptConflicts = outbox.conflicts.filter((c) => !newConflicts.some((n) => n.opId === c.opId));

  // Keep the write behind every new conflict before it leaves `writes`. This is
  // the only moment it is still reachable: after this the queue no longer has
  // it, and for every kind but `field_conflict` the conflict itself does not
  // carry the typed values either.
  const held = { ...outbox.held };
  for (const conflict of newConflicts) {
    const write = outbox.writes.find((w) => w.opId === conflict.opId);
    if (write) held[conflict.opId] = write;
  }
  // A write that was answered or dropped is not being held for anybody.
  for (const opId of Object.keys(held)) {
    const stillConflicted =
      keptConflicts.some((c) => c.opId === opId) || newConflicts.some((c) => c.opId === opId);
    if (!stillConflicted) delete held[opId];
  }

  return {
    ...outbox,
    writes: outbox.writes.filter((w) => !handled.has(w.opId)),
    conflicts: [...keptConflicts, ...newConflicts],
    held,
  };
}

/**
 * Drop an answered conflict, keeping nothing.
 *
 * For a conflict that was *answered* — Keep mine, Keep theirs — the edit has
 * been dealt with and there is nothing to record. Dismissing is the other case
 * and goes through {@link dismissConflict}.
 */
export function clearConflict(outbox: Outbox, opId: string): Outbox {
  const held = { ...outbox.held };
  delete held[opId];
  return { ...outbox, conflicts: outbox.conflicts.filter((c) => c.opId !== opId), held };
}

/**
 * Dismiss a conflict, keeping what it discarded — edge 7.
 *
 * The floor the brief set is that dismissing keeps a record. It does more than
 * the floor: the whole write is kept, so {@link restoreDiscarded} can put it
 * back. Dismissing is now reversible, and the thing it used to lose is the
 * thing it now hands back.
 */
export function dismissConflict(outbox: Outbox, opId: string, at: string = new Date().toISOString()): Outbox {
  const conflict = outbox.conflicts.find((c) => c.opId === opId);
  if (!conflict) return outbox;

  const entry: DiscardedEdit = {
    conflict,
    write: outbox.held[opId] ?? null,
    discardedAt: at,
  };

  const held = { ...outbox.held };
  delete held[opId];

  // Newest first, oldest dropped past the cap.
  const discarded = [entry, ...outbox.discarded.filter((d) => d.conflict.opId !== opId)].slice(
    0,
    DISCARD_LIMIT,
  );

  return {
    ...outbox,
    conflicts: outbox.conflicts.filter((c) => c.opId !== opId),
    held,
    discarded,
  };
}

/**
 * Put a dismissed edit back in the queue.
 *
 * It goes back with a **new sequence number**, at the end, deliberately: it has
 * been sitting out while other edits were sent, and re-inserting it at its old
 * position would put it ahead of writes that have already landed. Its `base`
 * is untouched, so the next flush compares it against the server as it is now
 * and either merges it, applies it, or raises the conflict again with today's
 * values — which is the honest answer rather than a stale one.
 */
export function restoreDiscarded(outbox: Outbox, opId: string): Outbox {
  const entry = outbox.discarded.find((d) => d.conflict.opId === opId);
  if (!entry || !entry.write) return outbox;

  return {
    ...outbox,
    writes: [...outbox.writes, { ...entry.write, seq: outbox.nextSeq }],
    nextSeq: outbox.nextSeq + 1,
    discarded: outbox.discarded.filter((d) => d.conflict.opId !== opId),
  };
}

/** Forget a dismissed edit for good. The only way to actually lose one. */
export function forgetDiscarded(outbox: Outbox, opId: string): Outbox {
  return { ...outbox, discarded: outbox.discarded.filter((d) => d.conflict.opId !== opId) };
}

/** Drop a queued write without sending it. The only way to lose an edit on purpose. */
export function discard(outbox: Outbox, opId: string): Outbox {
  return { ...outbox, writes: outbox.writes.filter((w) => w.opId !== opId) };
}

/** What is queued for one row, oldest first. Used to show a field as pending. */
export function pendingFor(outbox: Outbox, kind: SyncEntityKind, entityId: string): PendingWrite[] {
  return outbox.writes
    .filter((w) => w.entityKind === kind && w.entityId === entityId)
    .sort((a, b) => a.seq - b.seq);
}

/**
 * The value a field should *show*, given what is queued for it.
 *
 * This is the whole of "optimistic": the screen shows what the person typed,
 * marked as not yet sent, rather than what the server last said. The last
 * queued write for the field wins, because that is the one they typed last.
 */
export function optimisticValue(
  outbox: Outbox,
  kind: SyncEntityKind,
  entityId: string,
  field: string,
  serverValue: string | number | boolean | null,
): { value: string | number | boolean | null; isPending: boolean } {
  const queued = pendingFor(outbox, kind, entityId).filter((w) => field in w.changes);
  const last = queued[queued.length - 1];
  if (!last) return { value: serverValue, isPending: false };
  return { value: last.changes[field] ?? null, isPending: true };
}

/** Counts for the badge. Conflicts are counted apart: they need a person, not a network. */
export function outboxSummary(outbox: Outbox): { queued: number; conflicts: number; sentence: string } {
  const queued = outbox.writes.length;
  const conflicts = outbox.conflicts.length;
  const parts: string[] = [];
  if (queued > 0) parts.push(`${queued} edit${queued === 1 ? '' : 's'} waiting to be sent`);
  if (conflicts > 0) parts.push(`${conflicts} conflict${conflicts === 1 ? '' : 's'} to answer`);
  return {
    queued,
    conflicts,
    sentence: parts.length === 0 ? 'Everything on this device has been sent.' : parts.join(', ') + '.',
  };
}

// ---------------------------------------------------------------------------
// Which device this browser is
//
// The queue lives in `localStorage`, which is scoped to a browser profile, and
// every cursor on /sync belongs to a row in `devices`. Nothing connected the two,
// so the page described two different things without saying so. A device is
// identified by its *label*, because `devices` is keyed
// (space_id, owner_id, label): one browser is one row per space, which is what a
// space-scoped cursor requires. The label reaches the server in a cookie — see
// src/lib/sync/device.ts for why a cookie and not this file's `localStorage`.
// ---------------------------------------------------------------------------

/** The longest label the form accepts. The column is `text`; this is for reading. */
export const DEVICE_LABEL_MAX = 40;

/**
 * Trim, collapse the whitespace, cut to length.
 *
 * The label is half of a unique key, so " Laptop " and "Laptop" must not become
 * two devices: a browser appearing twice because somebody typed a trailing space
 * is exactly the confusion this whole change exists to remove.
 */
export function normaliseDeviceLabel(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, DEVICE_LABEL_MAX);
}

/**
 * A first suggestion for what to call this browser, from its own user agent.
 *
 * A suggestion only — it is put in the box and the person can change it. Nothing
 * is derived from it and nothing is sent anywhere: this is the same string the
 * server already sees on every request, used to save somebody typing "Laptop".
 */
export function suggestDeviceLabel(userAgent: string): string {
  const os = /Android/i.test(userAgent)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? 'iPhone'
      : /Mac OS X|Macintosh/i.test(userAgent)
        ? 'Mac'
        : /Windows/i.test(userAgent)
          ? 'Windows'
          : /Linux/i.test(userAgent)
            ? 'Linux'
            : 'Browser';
  const browser = /Firefox\//i.test(userAgent)
    ? 'Firefox'
    : /Edg\//i.test(userAgent)
      ? 'Edge'
      : /OPR\//i.test(userAgent)
        ? 'Opera'
        : /Chrome\//i.test(userAgent)
          ? 'Chrome'
          : /Safari\//i.test(userAgent)
            ? 'Safari'
            : 'browser';
  return normaliseDeviceLabel(`${os} ${browser}`);
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** A random enough id. `crypto.randomUUID` where it exists, which is everywhere Orbit runs. */
export function newOpId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `op-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export function readOutbox(): Outbox {
  if (typeof window === 'undefined') return EMPTY_OUTBOX;
  try {
    const raw = window.localStorage.getItem(OUTBOX_KEY);
    if (!raw) return EMPTY_OUTBOX;
    const parsed = JSON.parse(raw) as Partial<Outbox>;
    return {
      writes: Array.isArray(parsed.writes) ? parsed.writes : [],
      conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
      // Absent in `orbit.outbox.v1` as written before session 12. Defaulted
      // rather than version-bumped: an older queue is still a perfectly good
      // queue, and forcing it to be discarded to add a feature about not
      // discarding things would be a poor joke.
      held: parsed.held && typeof parsed.held === 'object' ? parsed.held : {},
      discarded: Array.isArray(parsed.discarded) ? parsed.discarded : [],
      nextSeq: typeof parsed.nextSeq === 'number' ? parsed.nextSeq : 1,
    };
  } catch {
    // A queue we cannot parse is a queue we cannot send. Losing it silently
    // would be worse than saying so, but there is nothing here that can say
    // anything — the caller renders the empty queue and the edits are gone.
    return EMPTY_OUTBOX;
  }
}

export function writeOutbox(outbox: Outbox): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
}

export function readOffline(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(OFFLINE_KEY) === 'yes';
}

export function writeOffline(offline: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(OFFLINE_KEY, offline ? 'yes' : 'no');
}
