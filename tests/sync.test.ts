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
