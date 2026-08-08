import { describe, expect, it } from 'vitest';
import {
  applyChoice,
  changedFields,
  clockSkew,
  displayValue,
  fieldLabel,
  isSyncEntityKind,
  planQueue,
  rebase,
  resolveWrite,
  sameValue,
  SYNC_ENTITY_KINDS,
  type Conflict,
  type PendingWrite,
  type ServerRow,
} from '@/lib/sync/conflict';
import {
  clearConflict,
  DEVICE_LABEL_MAX,
  DISCARD_LIMIT,
  dismissConflict,
  EMPTY_OUTBOX,
  forgetDiscarded,
  normaliseDeviceLabel,
  restoreDiscarded,
  settle,
  suggestDeviceLabel,
  type Outbox,
} from '@/lib/sync/outbox';

/**
 * Conflict handling.
 *
 * The brief has said since session 1 that sync's test coverage is second only
 * to RLS, and this is why: every bug here is silent. A merge that drops a
 * field, a replay that counts as a conflict, a delete that an edit quietly
 * undoes — none of them throw, none of them look wrong on the screen, and all
 * of them lose somebody's typing.
 *
 * Written before any of the UI, in the same order as the module: what wins,
 * then what merges, then what is held, then the queue, then the clock.
 */

const SPACE = '00000000-0000-4000-8000-000000000004';
const OTHER_SPACE = '00000000-0000-4000-8000-000000000005';

const T0 = '2026-07-29T09:00:00.000Z';
const T1 = '2026-07-29T09:05:00.000Z';
const T2 = '2026-07-29T09:10:00.000Z';

function write(over: Partial<PendingWrite> = {}): PendingWrite {
  return {
    opId: 'op-1',
    entityKind: 'task',
    entityId: 'task-1',
    spaceId: SPACE,
    label: 'Rename the task',
    baseUpdatedAt: T0,
    changes: { title: 'Put the bins out' },
    base: { title: 'Bins' },
    queuedAt: T1,
    seq: 1,
    ...over,
  };
}

function server(over: Partial<Extract<ServerRow, { exists: true }>> = {}): ServerRow {
  return {
    exists: true,
    updatedAt: T0,
    fields: { title: 'Bins' },
    isLocked: false,
    spaceId: SPACE,
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe('the clean case', () => {
  it('applies a write when nothing moved underneath it', () => {
    const r = resolveWrite(write(), server());
    expect(r.outcome).toBe('apply');
    if (r.outcome !== 'apply') throw new Error('unreachable');
    expect(r.apply).toEqual({ title: 'Put the bins out' });
    expect(r.opId).toBe('op-1');
  });

  it('applies only the fields the write actually changed', () => {
    const r = resolveWrite(
      write({
        changes: { title: 'Put the bins out', priority: 'high', body_md: 'unchanged' },
        base: { title: 'Bins', priority: 'none', body_md: 'unchanged' },
      }),
      server({ fields: { title: 'Bins', priority: 'none', body_md: 'unchanged' } }),
    );
    if (r.outcome !== 'apply') throw new Error(`expected apply, got ${r.outcome}`);
    expect(Object.keys(r.apply).sort()).toEqual(['priority', 'title']);
  });

  it('calls a write that changes nothing a noop, not an apply', () => {
    const r = resolveWrite(write({ changes: { title: 'Bins' }, base: { title: 'Bins' } }), server());
    expect(r.outcome).toBe('noop');
  });

  it('treats a null and an empty string as different values', () => {
    const r = resolveWrite(
      write({ changes: { waiting_on: '' }, base: { waiting_on: null } }),
      server({ fields: { waiting_on: null } }),
    );
    expect(r.outcome).toBe('apply');
  });
});

// ---------------------------------------------------------------------------

describe('two edits, different fields', () => {
  it('merges when the other side touched a field this write did not', () => {
    const r = resolveWrite(
      write({ changes: { title: 'Put the bins out' }, base: { title: 'Bins' } }),
      server({ updatedAt: T2, fields: { title: 'Bins', due_on: '2026-08-01' } }),
    );
    expect(r.outcome).toBe('merge');
    if (r.outcome !== 'merge') throw new Error('unreachable');
    expect(r.apply).toEqual({ title: 'Put the bins out' });
    expect(r.note).toMatch(/not on anything this edit touched/);
  });

  it('merges field by field: mine lands where they did not touch it', () => {
    const r = resolveWrite(
      write({
        changes: { title: 'Put the bins out', priority: 'high' },
        base: { title: 'Bins', priority: 'none' },
      }),
      // They changed the priority to what this write wanted, and left the title.
      server({ updatedAt: T2, fields: { title: 'Bins', priority: 'high' } }),
    );
    if (r.outcome !== 'merge') throw new Error(`expected merge, got ${r.outcome}`);
    expect(r.apply).toEqual({ title: 'Put the bins out' });
    expect(r.note).toMatch(/1 of 2 changes applied/);
  });

  it('is a merge, not a conflict, when both sides typed the same thing', () => {
    const r = resolveWrite(
      write({ changes: { title: 'Put the bins out' }, base: { title: 'Bins' } }),
      server({ updatedAt: T2, fields: { title: 'Put the bins out' } }),
    );
    // Everything it asked for is true, so it is a duplicate — the row already
    // says what the person wanted. Convergence is never a fight.
    expect(r.outcome).toBe('duplicate');
  });
});

// ---------------------------------------------------------------------------

describe('two edits, the same field', () => {
  it('holds the write and names both values', () => {
    const r = resolveWrite(
      write({ changes: { title: 'Put the bins out' }, base: { title: 'Bins' } }),
      server({ updatedAt: T2, fields: { title: 'Bin day is Thursday' } }),
    );
    expect(r.outcome).toBe('conflict');
    if (r.outcome !== 'conflict') throw new Error('unreachable');
    expect(r.conflict.kind).toBe('field_conflict');
    expect(r.conflict.clashes).toEqual([
      { field: 'title', mine: 'Put the bins out', theirs: 'Bin day is Thursday', base: 'Bins' },
    ]);
  });

  it('never silently picks a winner — there is no value in the resolution to apply', () => {
    const r = resolveWrite(
      write({ changes: { title: 'mine' }, base: { title: 'base' } }),
      server({ updatedAt: T2, fields: { title: 'theirs' } }),
    );
    if (r.outcome !== 'conflict') throw new Error('unreachable');
    expect(r.conflict.mergeable).toEqual({});
    expect('apply' in r).toBe(false);
  });

  it('keeps the fields that merged cleanly alongside the one that clashed', () => {
    const r = resolveWrite(
      write({
        changes: { title: 'mine', priority: 'high' },
        base: { title: 'base', priority: 'none' },
      }),
      server({ updatedAt: T2, fields: { title: 'theirs', priority: 'none' } }),
    );
    if (r.outcome !== 'conflict') throw new Error('unreachable');
    expect(r.conflict.clashes.map((c) => c.field)).toEqual(['title']);
    expect(r.conflict.mergeable).toEqual({ priority: 'high' });
  });

  it('carries the space so a conflict row can show the indicator', () => {
    const r = resolveWrite(
      write({ changes: { title: 'mine' }, base: { title: 'base' } }),
      server({ updatedAt: T2, fields: { title: 'theirs' } }),
    );
    if (r.outcome !== 'conflict') throw new Error('unreachable');
    expect(r.conflict.spaceId).toBe(SPACE);
    expect(r.conflict.entityKind).toBe('task');
    expect(r.conflict.entityId).toBe('task-1');
  });

  it('says what happened in a sentence, not a code', () => {
    const r = resolveWrite(
      write({ changes: { title: 'mine' }, base: { title: 'base' } }),
      server({ updatedAt: T2, fields: { title: 'theirs' } }),
    );
    if (r.outcome !== 'conflict') throw new Error('unreachable');
    expect(r.conflict.reason).toMatch(/nothing has been overwritten/i);
  });
});

// ---------------------------------------------------------------------------

describe('the row is gone, locked, or somewhere else', () => {
  it('refuses to resurrect a row deleted server-side', () => {
    const r = resolveWrite(write(), { exists: false });
    if (r.outcome !== 'conflict') throw new Error('unreachable');
    expect(r.conflict.kind).toBe('deleted_elsewhere');
    expect(r.conflict.reason).toMatch(/never brought back/i);
  });

  it('refuses a plaintext write to a row that was locked while it waited', () => {
    const r = resolveWrite(write(), server({ isLocked: true, updatedAt: T2 }));
    if (r.outcome !== 'conflict') throw new Error('unreachable');
    expect(r.conflict.kind).toBe('locked_elsewhere');
  });

  it('refuses a write whose row moved to another space', () => {
    const r = resolveWrite(write(), server({ spaceId: OTHER_SPACE, updatedAt: T2 }));
    if (r.outcome !== 'conflict') throw new Error('unreachable');
    expect(r.conflict.kind).toBe('moved_space');
  });

  // Order matters: all three make the field comparison meaningless, and a
  // locked row's fields are empty by database constraint — comparing them
  // would read as "they cleared the title", which is the most misleading
  // possible answer.
  it('decides gone before locked', () => {
    const r = resolveWrite(write(), { exists: false });
    if (r.outcome !== 'conflict') throw new Error('unreachable');
    expect(r.conflict.kind).toBe('deleted_elsewhere');
  });

  it('decides locked before comparing fields, even when the fields would clash', () => {
    const r = resolveWrite(
      write({ changes: { title: 'mine' }, base: { title: 'base' } }),
      server({ isLocked: true, updatedAt: T2, fields: { title: '' } }),
    );
    if (r.outcome !== 'conflict') throw new Error('unreachable');
    expect(r.conflict.kind).toBe('locked_elsewhere');
    expect(r.conflict.clashes).toEqual([]);
  });

  it('decides locked before deciding the write was a noop', () => {
    const r = resolveWrite(
      write({ changes: { title: 'same' }, base: { title: 'same' } }),
      server({ isLocked: true, updatedAt: T2 }),
    );
    if (r.outcome !== 'conflict') throw new Error('unreachable');
    expect(r.conflict.kind).toBe('locked_elsewhere');
  });

  it('decides moved-space before comparing fields', () => {
    const r = resolveWrite(
      write({ changes: { title: 'mine' }, base: { title: 'base' } }),
      server({ spaceId: OTHER_SPACE, updatedAt: T2, fields: { title: 'theirs' } }),
    );
    if (r.outcome !== 'conflict') throw new Error('unreachable');
    expect(r.conflict.kind).toBe('moved_space');
  });
});

// ---------------------------------------------------------------------------

describe('the same write arriving twice', () => {
  it('is a duplicate, not a conflict, when the server already holds the value', () => {
    const r = resolveWrite(
      write({ changes: { title: 'Put the bins out' }, base: { title: 'Bins' } }),
      server({ updatedAt: T2, fields: { title: 'Put the bins out' } }),
    );
    expect(r.outcome).toBe('duplicate');
    if (r.outcome !== 'duplicate') throw new Error('unreachable');
    expect(r.note).toMatch(/nothing was written twice/i);
    expect(r.apply).toEqual({});
  });

  it('is a duplicate even when every field of a multi-field write already landed', () => {
    const r = resolveWrite(
      write({
        changes: { title: 'new', priority: 'high' },
        base: { title: 'old', priority: 'none' },
      }),
      server({ updatedAt: T2, fields: { title: 'new', priority: 'high' } }),
    );
    expect(r.outcome).toBe('duplicate');
  });

  it('says so differently when the row never moved at all', () => {
    // Same value, same version: the edit was a no-change from the start.
    const r = resolveWrite(
      write({ changes: { title: 'Bins' }, base: { title: 'old' } }),
      server({ updatedAt: T0, fields: { title: 'Bins' } }),
    );
    if (r.outcome !== 'duplicate') throw new Error(`expected duplicate, got ${r.outcome}`);
    expect(r.note).toMatch(/already says that/i);
  });

  it('flushing a queue twice applies once and reports the second as already applied', () => {
    const w = write({ changes: { title: 'Put the bins out' }, base: { title: 'Bins' } });
    const first = resolveWrite(w, server());
    expect(first.outcome).toBe('apply');
    // The row now holds the new title and a new updated_at. The identical op
    // arrives again — a retry after a dropped response.
    const second = resolveWrite(w, server({ updatedAt: T2, fields: { title: 'Put the bins out' } }));
    expect(second.outcome).toBe('duplicate');
  });
});

// ---------------------------------------------------------------------------

describe('a row created offline', () => {
  it('applies when there is no base version to compare against', () => {
    const r = resolveWrite(
      write({ baseUpdatedAt: null, changes: { title: 'new thing' }, base: {} }),
      server({ updatedAt: T2, fields: { title: null } }),
    );
    // No base means nothing to say the server moved *underneath* it, and every
    // field is new. It lands.
    expect(r.outcome).toBe('merge');
    if (r.outcome !== 'merge') throw new Error('unreachable');
    expect(r.apply).toEqual({ title: 'new thing' });
  });
});

// ---------------------------------------------------------------------------

describe('answering a conflict', () => {
  const c: Conflict = {
    kind: 'field_conflict',
    opId: 'op-1',
    entityKind: 'task',
    entityId: 'task-1',
    spaceId: SPACE,
    clashes: [{ field: 'title', mine: 'mine', theirs: 'theirs', base: 'base' }],
    mergeable: { priority: 'high' },
    reason: 'x',
  };

  it('"keep mine" writes my value for the clash', () => {
    expect(applyChoice(c, 'mine')).toEqual({ priority: 'high', title: 'mine' });
  });

  it('"keep theirs" leaves their value alone', () => {
    expect(applyChoice(c, 'theirs')).toEqual({ priority: 'high' });
  });

  it('"keep theirs" is not "discard" — the undisputed fields still land', () => {
    expect(applyChoice(c, 'theirs')).toHaveProperty('priority', 'high');
  });

  it('has no answer for a deleted row', () => {
    expect(applyChoice({ ...c, kind: 'deleted_elsewhere', clashes: [] }, 'mine')).toEqual({});
  });

  it('has no answer for a locked row, even for the fields that merged', () => {
    expect(applyChoice({ ...c, kind: 'locked_elsewhere', clashes: [] }, 'mine')).toEqual({});
  });

  it('has no answer for a row that moved space', () => {
    expect(applyChoice({ ...c, kind: 'moved_space', clashes: [] }, 'theirs')).toEqual({});
  });

  it('answers every clash of a multi-field conflict at once', () => {
    const many: Conflict = {
      ...c,
      clashes: [
        { field: 'title', mine: 'a', theirs: 'b', base: 'c' },
        { field: 'body_md', mine: 'd', theirs: 'e', base: 'f' },
      ],
    };
    expect(applyChoice(many, 'mine')).toEqual({ priority: 'high', title: 'a', body_md: 'd' });
    expect(applyChoice(many, 'theirs')).toEqual({ priority: 'high' });
  });
});

// ---------------------------------------------------------------------------

describe('a queue', () => {
  it('sends in seq order, not the order it was handed', () => {
    const plan = planQueue([
      write({ opId: 'c', seq: 3 }),
      write({ opId: 'a', seq: 1 }),
      write({ opId: 'b', seq: 2 }),
    ]);
    expect(plan.ordered.map((w) => w.opId)).toEqual(['a', 'b', 'c']);
  });

  it('drops the second copy of an op and says which', () => {
    const plan = planQueue([write({ opId: 'a', seq: 1 }), write({ opId: 'a', seq: 2 })]);
    expect(plan.ordered).toHaveLength(1);
    expect(plan.droppedDuplicates).toEqual(['a']);
  });

  it('breaks a seq tie on the queued time, which is the only thing the clock decides', () => {
    const plan = planQueue([
      write({ opId: 'late', seq: 1, queuedAt: T2 }),
      write({ opId: 'early', seq: 1, queuedAt: T1 }),
    ]);
    expect(plan.ordered.map((w) => w.opId)).toEqual(['early', 'late']);
  });

  it('leaves an empty queue empty', () => {
    expect(planQueue([])).toEqual({ ordered: [], droppedDuplicates: [] });
  });

  it('does not mutate what it was given', () => {
    const original = [write({ opId: 'b', seq: 2 }), write({ opId: 'a', seq: 1 })];
    planQueue(original);
    expect(original.map((w) => w.opId)).toEqual(['b', 'a']);
  });
});

describe('two edits from one device to one row', () => {
  it('does not conflict with itself once the first is rebased into the second', () => {
    const first = write({ opId: 'op-1', seq: 1, changes: { title: 'second draft' }, base: { title: 'Bins' } });
    const second = write({ opId: 'op-2', seq: 2, changes: { title: 'third draft' }, base: { title: 'Bins' } });

    const r1 = resolveWrite(first, server());
    if (r1.outcome !== 'apply') throw new Error('unreachable');

    // Without the rebase, the second write's base still says "Bins" while the
    // server says "second draft" — the device would conflict with itself.
    const naive = resolveWrite(second, server({ updatedAt: T2, fields: { title: 'second draft' } }));
    expect(naive.outcome).toBe('conflict');

    const rebased = rebase(second, first.opId, r1.apply, T2);
    const r2 = resolveWrite(rebased, server({ updatedAt: T2, fields: { title: 'second draft' } }));
    expect(r2.outcome).toBe('apply');
    if (r2.outcome !== 'apply') throw new Error('unreachable');
    expect(r2.apply).toEqual({ title: 'third draft' });
  });

  it('rebasing leaves a write alone if it is the one that was applied', () => {
    const w = write({ opId: 'op-1' });
    expect(rebase(w, 'op-1', { title: 'x' }, T2)).toBe(w);
  });

  it('rebasing only touches fields the later write actually holds a base for', () => {
    const later = write({ opId: 'op-2', changes: { priority: 'high' }, base: { priority: 'none' } });
    const out = rebase(later, 'op-1', { title: 'a new title' }, T2);
    expect(out.base).toEqual({ priority: 'none' });
    expect(out.baseUpdatedAt).toBe(T2);
  });

  it('rebasing does not mutate the write it was given', () => {
    const later = write({ opId: 'op-2', base: { title: 'Bins' } });
    rebase(later, 'op-1', { title: 'moved on' }, T2);
    expect(later.base).toEqual({ title: 'Bins' });
    expect(later.baseUpdatedAt).toBe(T0);
  });
});

// ---------------------------------------------------------------------------

describe('clocks', () => {
  it('reports agreement when the two are close', () => {
    const r = clockSkew('2026-07-29T09:00:10.000Z', '2026-07-29T09:00:00.000Z');
    expect(r.skewSeconds).toBe(10);
    expect(r.isSuspicious).toBe(false);
    expect(r.sentence).toMatch(/agrees/);
  });

  it('names a device running ahead', () => {
    const r = clockSkew('2026-07-29T12:00:00.000Z', '2026-07-29T09:00:00.000Z');
    expect(r.skewSeconds).toBe(10_800);
    expect(r.isSuspicious).toBe(true);
    expect(r.sentence).toMatch(/3\.0 hours ahead/);
  });

  it('names a device running behind', () => {
    const r = clockSkew('2026-07-29T08:50:00.000Z', '2026-07-29T09:00:00.000Z');
    expect(r.skewSeconds).toBe(-600);
    expect(r.sentence).toMatch(/10 minutes behind/);
  });

  it('says out loud that nothing is ordered by it', () => {
    const r = clockSkew('2026-07-29T12:00:00.000Z', '2026-07-29T09:00:00.000Z');
    expect(r.sentence).toMatch(/nothing is ordered by them/);
  });

  // The point of decision 3, asserted rather than asserted-in-a-comment: a
  // device three hours ahead still resolves exactly as one in step, because
  // the resolution never reads a client timestamp.
  it('a wrong clock changes no outcome', () => {
    const inStep = resolveWrite(write({ queuedAt: T1 }), server());
    const wayAhead = resolveWrite(write({ queuedAt: '2027-01-01T00:00:00.000Z' }), server());
    const wayBehind = resolveWrite(write({ queuedAt: '2020-01-01T00:00:00.000Z' }), server());
    expect(wayAhead).toEqual(inStep);
    expect(wayBehind).toEqual(inStep);
  });

  it('a wrong clock does not turn a merge into a conflict', () => {
    const s = server({ updatedAt: T2, fields: { title: 'Bins', due_on: '2026-08-01' } });
    const a = resolveWrite(write({ queuedAt: '2019-01-01T00:00:00.000Z' }), s);
    const b = resolveWrite(write({ queuedAt: '2031-01-01T00:00:00.000Z' }), s);
    expect(a.outcome).toBe('merge');
    expect(b.outcome).toBe('merge');
  });
});

// ---------------------------------------------------------------------------

describe('the small pieces', () => {
  it('knows the entity kinds sync covers', () => {
    expect(SYNC_ENTITY_KINDS).toEqual(['task', 'note', 'event', 'person', 'place']);
    expect(isSyncEntityKind('task')).toBe(true);
    expect(isSyncEntityKind('rule')).toBe(false);
    expect(isSyncEntityKind(null)).toBe(false);
  });

  it('compares values the way a form would', () => {
    expect(sameValue('a', 'a')).toBe(true);
    expect(sameValue(null, null)).toBe(true);
    expect(sameValue(null, '')).toBe(false);
    expect(sameValue(0, null)).toBe(false);
    expect(sameValue(false, null)).toBe(false);
    expect(sameValue(1, 1)).toBe(true);
  });

  it('lists the changed fields in a stable order', () => {
    expect(
      changedFields(
        write({
          changes: { title: 'a', priority: 'high', body_md: 'same' },
          base: { title: 'b', priority: 'none', body_md: 'same' },
        }),
      ),
    ).toEqual(['priority', 'title']);
  });

  it('labels fields as a person would read them, falling back to the column', () => {
    expect(fieldLabel('due_on')).toBe('Due date');
    expect(fieldLabel('body_md')).toBe('Body');
    expect(fieldLabel('some_new_column')).toBe('some_new_column');
  });

  it('shows an empty value as a dash rather than as nothing', () => {
    expect(displayValue(null)).toBe('—');
    expect(displayValue('')).toBe('—');
    expect(displayValue(false)).toBe('no');
    expect(displayValue('high')).toBe('high');
    expect(displayValue(30)).toBe('30');
  });
});

/**
 * Which device this browser is.
 *
 * The queue lives in `localStorage`, scoped to a browser profile; every cursor
 * belongs to a row in `devices`, keyed `(space_id, owner_id, label)`. Nothing
 * connected the two, so `/sync` showed both halves and did not say they might be
 * describing different devices. The connection is a label, and a label that is
 * half of a unique key has to be normalised in exactly one place — otherwise
 * " Laptop " and "Laptop" become two devices and the page it was meant to fix
 * shows one browser twice.
 */
describe('naming this browser', () => {
  it('collapses whitespace so one browser cannot become two devices', () => {
    expect(normaliseDeviceLabel('  Priya — laptop  ')).toBe('Priya — laptop');
    expect(normaliseDeviceLabel('Priya\t—\n laptop')).toBe('Priya — laptop');
    expect(normaliseDeviceLabel('Priya  —  laptop')).toBe('Priya — laptop');
  });

  it('is idempotent, so saving the same name twice claims the same row', () => {
    const once = normaliseDeviceLabel('  the   Kitchen iPad ');
    expect(normaliseDeviceLabel(once)).toBe(once);
  });

  it('gives back nothing for a name that is only whitespace', () => {
    // The server action refuses this rather than creating a device called "".
    expect(normaliseDeviceLabel('   ')).toBe('');
    expect(normaliseDeviceLabel('')).toBe('');
  });

  it('cuts a very long name to a length that fits a row', () => {
    const long = normaliseDeviceLabel('x'.repeat(200));
    expect(long.length).toBe(DEVICE_LABEL_MAX);
  });

  it('suggests a name from the user agent, without inventing precision', () => {
    expect(
      suggestDeviceLabel(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      ),
    ).toBe('Mac Chrome');
    expect(suggestDeviceLabel('Mozilla/5.0 (X11; Linux x86_64) Firefox/141.0')).toBe('Linux Firefox');
    expect(
      suggestDeviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1'),
    ).toBe('iPhone Safari');
  });

  it('tells Edge and Opera from the Chrome they both claim to be', () => {
    // Both send "Chrome/..." in their user agent, so order of checks matters.
    expect(suggestDeviceLabel('Windows NT 10.0 Chrome/140.0 Safari/537.36 Edg/140.0')).toBe(
      'Windows Edge',
    );
    expect(suggestDeviceLabel('Windows NT 10.0 Chrome/140.0 Safari/537.36 OPR/120.0')).toBe(
      'Windows Opera',
    );
  });

  it('falls back to something honest for a user agent it does not know', () => {
    expect(suggestDeviceLabel('')).toBe('Browser browser');
    expect(suggestDeviceLabel('curl/8.5.0')).toBe('Browser browser');
  });

  it('always suggests something a device row would accept', () => {
    for (const ua of ['', 'curl/8.5.0', 'x'.repeat(500), 'Mozilla/5.0 (Android 15) Chrome/140.0']) {
      const s = suggestDeviceLabel(ua);
      expect(s).toBe(normaliseDeviceLabel(s));
      expect(s.length).toBeGreaterThan(0);
      expect(s.length).toBeLessThanOrEqual(DEVICE_LABEL_MAX);
    }
  });
});

// ---------------------------------------------------------------------------
// Edge 7 — a dismissed conflict keeps what it discarded
// ---------------------------------------------------------------------------

/**
 * The one with the most teeth, and the reason it had them.
 *
 * `settle` takes a conflicted write out of `writes` — correctly, since it is no
 * longer waiting to be sent. Until session 12 that was the last anybody saw of
 * it. For a `field_conflict` the typed values survived inside `clashes[].mine`,
 * but `clashes` is empty for every other kind, so a `deleted_elsewhere`,
 * `locked_elsewhere` or `moved_space` conflict discarded somebody's typing the
 * moment it was raised — before they had touched anything. Dismissing then
 * deleted the record of it too.
 */
describe('a conflicted write is kept, not dropped', () => {
  const write: PendingWrite = {
    opId: 'op-1',
    seq: 1,
    queuedAt: '2026-08-08T10:00:00Z',
    entityKind: 'task',
    entityId: 'task-1',
    spaceId: 'space-1',
    label: 'Ring the plumber',
    changes: { title: 'Ring the plumber', due_on: '2026-08-12' },
    base: { title: 'Ring the plumber back', due_on: null },
    baseUpdatedAt: '2026-08-08T09:00:00Z',
  };

  const conflictOf = (kind: Conflict['kind']): Conflict => ({
    kind,
    opId: 'op-1',
    entityKind: 'task',
    entityId: 'task-1',
    spaceId: 'space-1',
    // Empty for every kind but field_conflict — which is the whole problem.
    clashes: [],
    mergeable: {},
    reason: 'Somebody else got there first.',
  });

  const queued = (): Outbox => ({ ...EMPTY_OUTBOX, writes: [write], nextSeq: 2 });

  const settled = (kind: Conflict['kind']): Outbox =>
    settle(queued(), [
      { opId: 'op-1', outcome: 'conflict', note: null, conflict: conflictOf(kind) },
    ]);

  it.each(['field_conflict', 'deleted_elsewhere', 'locked_elsewhere', 'moved_space'] as const)(
    'holds the edit behind a %s conflict',
    (kind) => {
      const out = settled(kind);
      expect(out.writes).toHaveLength(0);
      expect(out.conflicts).toHaveLength(1);
      // The typed values are still reachable, whatever the kind.
      expect(out.held['op-1']).toEqual(write);
      expect(out.held['op-1']!.changes).toEqual({
        title: 'Ring the plumber',
        due_on: '2026-08-12',
      });
    },
  );

  it('stops holding it once the conflict is answered', () => {
    // Answering is not dismissing: the edit has been dealt with, so there is
    // nothing to record and nothing to keep.
    const out = clearConflict(settled('field_conflict'), 'op-1');
    expect(out.conflicts).toHaveLength(0);
    expect(out.held).toEqual({});
    expect(out.discarded).toHaveLength(0);
  });

  it('dismissing records the conflict *and* the edit', () => {
    const out = dismissConflict(settled('deleted_elsewhere'), 'op-1', '2026-08-08T11:00:00Z');

    expect(out.conflicts).toHaveLength(0);
    expect(out.held).toEqual({});
    expect(out.discarded).toHaveLength(1);

    const [entry] = out.discarded;
    expect(entry!.conflict.kind).toBe('deleted_elsewhere');
    expect(entry!.discardedAt).toBe('2026-08-08T11:00:00Z');
    // The thing dismissing used to lose.
    expect(entry!.write).toEqual(write);
  });

  it('dismissing an opId that is not there changes nothing', () => {
    const before = settled('field_conflict');
    expect(dismissConflict(before, 'op-nope')).toEqual(before);
  });

  it('never keeps two records for one conflict', () => {
    const once = dismissConflict(settled('field_conflict'), 'op-1', '2026-08-08T11:00:00Z');
    const twice = dismissConflict(
      { ...once, conflicts: [conflictOf('field_conflict')], held: { 'op-1': write } },
      'op-1',
      '2026-08-08T12:00:00Z',
    );
    expect(twice.discarded).toHaveLength(1);
    expect(twice.discarded[0]!.discardedAt).toBe('2026-08-08T12:00:00Z');
  });
});

describe('a dismissed edit can be put back', () => {
  const write: PendingWrite = {
    opId: 'op-1',
    seq: 1,
    queuedAt: '2026-08-08T10:00:00Z',
    entityKind: 'task',
    entityId: 'task-1',
    spaceId: 'space-1',
    label: 'Ring the plumber',
    changes: { title: 'Ring the plumber' },
    base: { title: 'Ring the plumber back' },
    baseUpdatedAt: '2026-08-08T09:00:00Z',
  };

  const conflict: Conflict = {
    kind: 'field_conflict',
    opId: 'op-1',
    entityKind: 'task',
    entityId: 'task-1',
    spaceId: 'space-1',
    clashes: [],
    mergeable: {},
    reason: 'Both of you changed the title.',
  };

  const dismissed = (): Outbox =>
    dismissConflict(
      settle({ ...EMPTY_OUTBOX, writes: [write], nextSeq: 2 }, [
        { opId: 'op-1', outcome: 'conflict', note: null, conflict },
      ]),
      'op-1',
      '2026-08-08T11:00:00Z',
    );

  it('returns it to the queue and takes it off the list', () => {
    const out = restoreDiscarded(dismissed(), 'op-1');
    expect(out.discarded).toHaveLength(0);
    expect(out.writes).toHaveLength(1);
    expect(out.writes[0]!.changes).toEqual({ title: 'Ring the plumber' });
  });

  it('gives it a new sequence number, at the end of the queue', () => {
    // It sat out while other edits were sent. Re-inserting it at its old
    // position would put it ahead of writes that have already landed.
    const before = dismissed();
    const out = restoreDiscarded({ ...before, nextSeq: 9 }, 'op-1');
    expect(out.writes[0]!.seq).toBe(9);
    expect(out.nextSeq).toBe(10);
  });

  it('keeps its base, so the next send judges it against the server as it is now', () => {
    // Not rebased here on purpose: `flushQueue` compares `base` against the
    // current row, so an unchanged base is what lets the answer be "merged",
    // "applied" or "the same conflict again, with today's values".
    const out = restoreDiscarded(dismissed(), 'op-1');
    expect(out.writes[0]!.base).toEqual(write.base);
    expect(out.writes[0]!.baseUpdatedAt).toBe(write.baseUpdatedAt);
  });

  it('does nothing for a record with no edit behind it', () => {
    // A conflict dismissed before session 12 has a record and no values.
    const legacy: Outbox = {
      ...EMPTY_OUTBOX,
      discarded: [{ conflict, write: null, discardedAt: '2026-08-01T00:00:00Z' }],
    };
    expect(restoreDiscarded(legacy, 'op-1')).toEqual(legacy);
  });

  it('forgetting one is the only way to actually lose it', () => {
    const out = forgetDiscarded(dismissed(), 'op-1');
    expect(out.discarded).toHaveLength(0);
    expect(out.writes).toHaveLength(0);
  });

  it('caps the list so it cannot be the reason a queue fails to save', () => {
    let outbox: Outbox = EMPTY_OUTBOX;
    for (let i = 0; i < DISCARD_LIMIT + 10; i += 1) {
      const opId = `op-${i}`;
      outbox = dismissConflict(
        {
          ...outbox,
          conflicts: [{ ...conflict, opId }],
          held: { [opId]: { ...write, opId } },
        },
        opId,
        `2026-08-08T${String(i % 24).padStart(2, '0')}:00:00Z`,
      );
    }
    expect(outbox.discarded).toHaveLength(DISCARD_LIMIT);
    // Newest first, so the oldest are the ones dropped.
    expect(outbox.discarded[0]!.conflict.opId).toBe(`op-${DISCARD_LIMIT + 9}`);
  });
});
