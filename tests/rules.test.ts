import { describe, expect, it } from 'vitest';
import {
  RuleShapeError,
  describeAction,
  describeCondition,
  describeRule,
  effectOf,
  evaluate,
  evaluateAll,
  isSweep,
  matchCondition,
  matchConditions,
  parseActions,
  parseConditions,
  parseTrigger,
  readField,
  validateRule,
  type Action,
  type Condition,
  type Members,
  type Rule,
  type TaskFact,
} from '@/lib/rules';

/**
 * The rules engine is the declared bug farm of Phase 4, so these cases were
 * written before any UI touched the module — the same way recurrence and travel
 * were done, and both stayed solid.
 *
 * The cases that matter most are the two refusals: a rule must never act on a
 * locked item, and never across a space boundary. Both are asserted from
 * several directions, including the one where the caller has already made the
 * mistake and handed the evaluator a fact it should not have.
 */

const HOME = '11111111-1111-1111-1111-111111111111';
const WORK = '22222222-2222-2222-2222-222222222222';
const PRIYA = { id: 'p-1', name: 'Priya' };
const DANNY = { id: 'p-2', name: 'Danny' };
const MEMBERS: Members = { me: PRIYA, partner: DANNY };
const ALONE: Members = { me: PRIYA, partner: null };

/** 2026-07-28 is a Tuesday, and BST. Every date case below is anchored to it. */
const TODAY = '2026-07-28';

function task(over: Partial<TaskFact> = {}): TaskFact {
  return {
    kind: 'task',
    id: 't-1',
    spaceId: HOME,
    isLocked: false,
    title: 'Put the bins out',
    body: '',
    status: 'todo',
    priority: 'none',
    categorySlug: 'home',
    assigneeName: null,
    assigneeId: null,
    dueOn: null,
    deferredUntil: null,
    estimateMinutes: null,
    ...over,
  };
}

function rule(over: Partial<Rule> = {}): Rule {
  return {
    id: 'r-1',
    spaceId: HOME,
    name: 'Bins go to Danny',
    trigger: { kind: 'task.created' },
    conditions: [{ field: 'title', op: 'contains', value: 'bin' }],
    actions: [{ kind: 'task.assign', to: 'partner' }],
    isEnabled: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe('parsing what the database hands back', () => {
  it('reads the two seeded triggers', () => {
    expect(parseTrigger({ kind: 'task.created' })).toEqual({ kind: 'task.created' });
    expect(parseTrigger({ kind: 'schedule', cron: '0 7 * * *' })).toEqual({
      kind: 'schedule',
      cron: '0 7 * * *',
    });
  });

  it('gives a schedule with no cron a daily default rather than failing', () => {
    expect(parseTrigger({ kind: 'schedule' })).toEqual({ kind: 'schedule', cron: '0 7 * * *' });
  });

  it('refuses a trigger kind it does not know', () => {
    expect(() => parseTrigger({ kind: 'task.deleted' })).toThrow(RuleShapeError);
    expect(() => parseTrigger('task.created')).toThrow(RuleShapeError);
    expect(() => parseTrigger([{ kind: 'task.created' }])).toThrow(RuleShapeError);
  });

  it('refuses a condition on a field that does not exist', () => {
    // The failure this prevents: a typo becomes a rule that silently never matches.
    expect(() => parseConditions([{ field: 'titel', op: 'contains', value: 'bin' }])).toThrow(
      /field Orbit does not know/,
    );
  });

  it('refuses an operator it does not know', () => {
    expect(() => parseConditions([{ field: 'title', op: 'matches', value: '.*' }])).toThrow(
      /operator Orbit does not know/,
    );
  });

  it('treats a missing value as null rather than undefined', () => {
    expect(parseConditions([{ field: 'title', op: 'is_set' }])).toEqual([
      { field: 'title', op: 'is_set', value: null },
    ]);
  });

  it('parses every action kind', () => {
    const actions = parseActions([
      { kind: 'task.set_priority', priority: 'high' },
      { kind: 'task.set_status', status: 'blocked' },
      { kind: 'task.assign', to: 'partner' },
      { kind: 'task.defer_days', days: 3 },
      { kind: 'task.due_in_days', days: 0 },
      { kind: 'notify', message: 'Bins tonight' },
    ]);
    expect(actions).toHaveLength(6);
  });

  it('refuses an unknown priority, status, assignee and action kind', () => {
    expect(() => parseActions([{ kind: 'task.set_priority', priority: 'critical' }])).toThrow(
      /unknown priority/,
    );
    expect(() => parseActions([{ kind: 'task.set_status', status: 'finished' }])).toThrow(
      /unknown status/,
    );
    expect(() => parseActions([{ kind: 'task.assign', to: 'sadia' }])).toThrow(/cannot resolve/);
    expect(() => parseActions([{ kind: 'task.delete' }])).toThrow(/unknown action/);
  });

  it('refuses a day count that is negative, fractional or absurd', () => {
    for (const days of [-1, 1.5, 4000, 'soon']) {
      expect(() => parseActions([{ kind: 'task.defer_days', days }])).toThrow(/whole number/);
    }
  });

  it('reports every problem with a rule at once', () => {
    const problems = validateRule({
      trigger: { kind: 'nope' },
      conditions: 'not an array',
      actions: [{ kind: 'task.set_priority', priority: 'critical' }],
    });
    expect(problems).toHaveLength(3);
  });

  it('calls a rule with no actions a problem, because it would never do anything', () => {
    expect(
      validateRule({ trigger: { kind: 'task.created' }, conditions: [], actions: [] }),
    ).toEqual(['a rule with no actions would never do anything']);
  });

  it('accepts the rule the seed writes', () => {
    expect(
      validateRule({
        trigger: { kind: 'schedule', cron: '0 7 * * *' },
        conditions: [
          { field: 'category.slug', op: 'eq', value: 'admin' },
          { field: 'days_overdue', op: 'gte', value: 7 },
        ],
        actions: [{ kind: 'task.set_priority', priority: 'high' }],
      }),
    ).toEqual([]);
  });

  it('knows which triggers sweep and which react', () => {
    expect(isSweep({ kind: 'schedule', cron: '0 7 * * *' })).toBe(true);
    expect(isSweep({ kind: 'task.created' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('reading a field off a fact', () => {
  it('reads the plain ones', () => {
    const f = task({ title: 'Bins', body: 'green one', priority: 'high', status: 'doing' });
    expect(readField(f, 'title', TODAY)).toBe('Bins');
    expect(readField(f, 'body', TODAY)).toBe('green one');
    expect(readField(f, 'priority', TODAY)).toBe('high');
    expect(readField(f, 'status', TODAY)).toBe('doing');
    expect(readField(f, 'category.slug', TODAY)).toBe('home');
  });

  it('counts days overdue as positive in the past', () => {
    expect(readField(task({ dueOn: '2026-07-21' }), 'days_overdue', TODAY)).toBe(7);
    expect(readField(task({ dueOn: '2026-07-28' }), 'days_overdue', TODAY)).toBe(0);
    expect(readField(task({ dueOn: '2026-08-04' }), 'days_overdue', TODAY)).toBe(-7);
  });

  it('counts days until due as positive in the future', () => {
    expect(readField(task({ dueOn: '2026-08-04' }), 'days_until_due', TODAY)).toBe(7);
    expect(readField(task({ dueOn: '2026-07-21' }), 'days_until_due', TODAY)).toBe(-7);
  });

  it('answers null, not zero, when there is no due date', () => {
    // An undated task is not zero days overdue. This is the difference between
    // "overdue by a week" matching nothing and matching the whole inbox.
    expect(readField(task({ dueOn: null }), 'days_overdue', TODAY)).toBeNull();
    expect(readField(task({ dueOn: null }), 'days_until_due', TODAY)).toBeNull();
    expect(readField(task({ dueOn: null }), 'has_due_date', TODAY)).toBe(false);
    expect(readField(task({ dueOn: '2026-07-21' }), 'has_due_date', TODAY)).toBe(true);
  });

  it('reads the assignee by name, and null when unassigned', () => {
    expect(readField(task({ assigneeName: 'Danny' }), 'assignee', TODAY)).toBe('Danny');
    expect(readField(task(), 'assignee', TODAY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('days overdue across a clock change', () => {
  /**
   * A day is 23 hours long on 29 March 2026 and 25 on 25 October. "Seven days
   * overdue" must mean seven calendar days on both weekends, which it only does
   * because the arithmetic anchors both sides at UTC midnight of a date rather
   * than subtracting instants.
   */
  it('counts seven calendar days across the spring forward', () => {
    expect(readField(task({ dueOn: '2026-03-25' }), 'days_overdue', '2026-04-01')).toBe(7);
    expect(readField(task({ dueOn: '2026-03-28' }), 'days_overdue', '2026-03-30')).toBe(2);
  });

  it('counts seven calendar days across the autumn back', () => {
    expect(readField(task({ dueOn: '2026-10-21' }), 'days_overdue', '2026-10-28')).toBe(7);
    expect(readField(task({ dueOn: '2026-10-24' }), 'days_overdue', '2026-10-26')).toBe(2);
  });

  it('a rule that fires at 7 days fires on the same task on both weekends', () => {
    const r = rule({
      conditions: [{ field: 'days_overdue', op: 'gte', value: 7 }],
      actions: [{ kind: 'task.set_priority', priority: 'high' }],
    });
    expect(evaluate(r, task({ dueOn: '2026-03-25' }), MEMBERS, '2026-04-01').matched).toBe(true);
    expect(evaluate(r, task({ dueOn: '2026-03-26' }), MEMBERS, '2026-04-01').matched).toBe(false);
    expect(evaluate(r, task({ dueOn: '2026-10-21' }), MEMBERS, '2026-10-28').matched).toBe(true);
    expect(evaluate(r, task({ dueOn: '2026-10-22' }), MEMBERS, '2026-10-28').matched).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('matching one condition', () => {
  const c = (over: Partial<Condition>): Condition =>
    ({ field: 'title', op: 'contains', value: 'bin', ...over }) as Condition;

  it('contains is case-insensitive both ways', () => {
    expect(matchCondition(task({ title: 'Put the BINS out' }), c({}), TODAY)).toBe(true);
    expect(matchCondition(task({ title: 'bins' }), c({ value: 'BIN' }), TODAY)).toBe(true);
  });

  it('contains trims the value the user typed but not the field', () => {
    expect(matchCondition(task({ title: 'bins' }), c({ value: '  bin  ' }), TODAY)).toBe(true);
  });

  it('contains is a substring, so it matches inside a word', () => {
    // Recorded because it is a real footgun: "bin" matches "binder" and
    // "combine". The preview is what saves somebody from it.
    expect(matchCondition(task({ title: 'Buy a binder' }), c({}), TODAY)).toBe(true);
  });

  it('does not contain is true when the field is empty', () => {
    expect(matchCondition(task({ body: '' }), c({ field: 'body', op: 'not_contains' }), TODAY)).toBe(true);
    expect(
      matchCondition(task({ categorySlug: null }), c({ field: 'category.slug', op: 'not_contains', value: 'admin' }), TODAY),
    ).toBe(true);
  });

  it('contains is false when the field is null, rather than throwing', () => {
    expect(
      matchCondition(task({ categorySlug: null }), c({ field: 'category.slug', op: 'contains', value: 'admin' }), TODAY),
    ).toBe(false);
  });

  it('eq compares case-insensitively and trimmed', () => {
    expect(matchCondition(task({ priority: 'high' }), c({ field: 'priority', op: 'eq', value: 'HIGH' }), TODAY)).toBe(true);
    expect(matchCondition(task({ priority: 'high' }), c({ field: 'priority', op: 'eq', value: ' high ' }), TODAY)).toBe(true);
    expect(matchCondition(task({ priority: 'low' }), c({ field: 'priority', op: 'eq', value: 'high' }), TODAY)).toBe(false);
  });

  it('neq is the exact negation of eq', () => {
    for (const value of ['high', 'low', '']) {
      const f = task({ priority: 'high' });
      const eq = matchCondition(f, c({ field: 'priority', op: 'eq', value }), TODAY);
      const neq = matchCondition(f, c({ field: 'priority', op: 'neq', value }), TODAY);
      expect(neq).toBe(!eq);
    }
  });

  it('is_set and is_empty treat null and the empty string alike', () => {
    expect(matchCondition(task({ assigneeName: null }), c({ field: 'assignee', op: 'is_empty' }), TODAY)).toBe(true);
    expect(matchCondition(task({ body: '' }), c({ field: 'body', op: 'is_empty' }), TODAY)).toBe(true);
    expect(matchCondition(task({ body: 'x' }), c({ field: 'body', op: 'is_set' }), TODAY)).toBe(true);
    expect(matchCondition(task({ assigneeName: 'Danny' }), c({ field: 'assignee', op: 'is_set' }), TODAY)).toBe(true);
  });

  it('numeric comparisons are false when the field is unset', () => {
    for (const op of ['gte', 'lte', 'gt', 'lt'] as const) {
      expect(
        matchCondition(task({ dueOn: null }), c({ field: 'days_overdue', op, value: 7 }), TODAY),
      ).toBe(false);
    }
  });

  it('numeric comparisons accept a number typed as a string', () => {
    // Every value in a jsonb rule written by a form arrives as a string.
    expect(
      matchCondition(task({ dueOn: '2026-07-14' }), c({ field: 'days_overdue', op: 'gte', value: '7' }), TODAY),
    ).toBe(true);
  });

  it('numeric comparisons are false when the value is not a number at all', () => {
    expect(
      matchCondition(task({ dueOn: '2026-07-14' }), c({ field: 'days_overdue', op: 'gte', value: 'lots' }), TODAY),
    ).toBe(false);
  });

  it('gte and gt differ exactly on the boundary', () => {
    const f = task({ dueOn: '2026-07-21' }); // exactly 7 days overdue
    expect(matchCondition(f, c({ field: 'days_overdue', op: 'gte', value: 7 }), TODAY)).toBe(true);
    expect(matchCondition(f, c({ field: 'days_overdue', op: 'gt', value: 7 }), TODAY)).toBe(false);
    expect(matchCondition(f, c({ field: 'days_overdue', op: 'lte', value: 7 }), TODAY)).toBe(true);
    expect(matchCondition(f, c({ field: 'days_overdue', op: 'lt', value: 7 }), TODAY)).toBe(false);
  });

  it('a boolean field compares against the string a form would submit', () => {
    expect(matchCondition(task({ dueOn: '2026-08-01' }), c({ field: 'has_due_date', op: 'eq', value: 'true' }), TODAY)).toBe(true);
    expect(matchCondition(task({ dueOn: null }), c({ field: 'has_due_date', op: 'eq', value: false }), TODAY)).toBe(true);
    expect(matchCondition(task({ dueOn: null }), c({ field: 'has_due_date', op: 'eq', value: 'true' }), TODAY)).toBe(false);
  });

  it('estimate_minutes compares as a number and is null when unset', () => {
    expect(matchCondition(task({ estimateMinutes: 90 }), c({ field: 'estimate_minutes', op: 'gt', value: 60 }), TODAY)).toBe(true);
    expect(matchCondition(task({ estimateMinutes: null }), c({ field: 'estimate_minutes', op: 'gt', value: 0 }), TODAY)).toBe(false);
  });
});

describe('matching all the conditions', () => {
  it('ANDs them', () => {
    const conds: Condition[] = [
      { field: 'category.slug', op: 'eq', value: 'admin' },
      { field: 'days_overdue', op: 'gte', value: 7 },
    ];
    expect(matchConditions(task({ categorySlug: 'admin', dueOn: '2026-07-01' }), conds, TODAY)).toBe(true);
    expect(matchConditions(task({ categorySlug: 'home', dueOn: '2026-07-01' }), conds, TODAY)).toBe(false);
    expect(matchConditions(task({ categorySlug: 'admin', dueOn: '2026-07-27' }), conds, TODAY)).toBe(false);
  });

  it('no conditions matches everything, which is legal and loud', () => {
    expect(matchConditions(task(), [], TODAY)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('what an action would do', () => {
  it('describes the change in a sentence naming both sides', () => {
    const e = effectOf({ kind: 'task.set_priority', priority: 'high' }, task({ title: 'File VAT' }), MEMBERS, TODAY);
    expect(e).toMatchObject({ kind: 'task.update', field: 'priority', value: 'high', before: 'no priority', after: 'high' });
    expect(e?.description).toBe('Set “File VAT” to high priority (it is no priority now)');
  });

  it('produces nothing when the item already looks the way the rule wants', () => {
    // A scheduled rule sweeps the same rows every morning. Without this the
    // audit trail would fill with changes that changed nothing.
    expect(effectOf({ kind: 'task.set_priority', priority: 'high' }, task({ priority: 'high' }), MEMBERS, TODAY)).toBeNull();
    expect(effectOf({ kind: 'task.set_status', status: 'todo' }, task({ status: 'todo' }), MEMBERS, TODAY)).toBeNull();
    expect(effectOf({ kind: 'task.assign', to: 'partner' }, task({ assigneeId: DANNY.id, assigneeName: 'Danny' }), MEMBERS, TODAY)).toBeNull();
    expect(effectOf({ kind: 'task.due_in_days', days: 0 }, task({ dueOn: TODAY }), MEMBERS, TODAY)).toBeNull();
  });

  it('resolves the partner by membership, never by an id in the rule', () => {
    const e = effectOf({ kind: 'task.assign', to: 'partner' }, task(), MEMBERS, TODAY);
    expect(e).toMatchObject({ field: 'assignee_id', value: DANNY.id, before: 'nobody', after: 'Danny' });
  });

  it('does nothing at all when the rule says partner and there is no partner', () => {
    // Quietly assigning to the owner instead would be the rule doing something
    // it does not say.
    expect(effectOf({ kind: 'task.assign', to: 'partner' }, task(), ALONE, TODAY)).toBeNull();
  });

  it('assigns to me and unassigns', () => {
    expect(effectOf({ kind: 'task.assign', to: 'me' }, task(), ALONE, TODAY)).toMatchObject({
      value: PRIYA.id,
      after: 'Priya',
    });
    expect(
      effectOf({ kind: 'task.assign', to: 'nobody' }, task({ assigneeId: DANNY.id, assigneeName: 'Danny' }), MEMBERS, TODAY),
    ).toMatchObject({ value: null, before: 'Danny', after: 'nobody' });
  });

  it('counts deferral and due dates forward from the day the run happens', () => {
    expect(effectOf({ kind: 'task.defer_days', days: 3 }, task(), MEMBERS, TODAY)).toMatchObject({
      field: 'deferred_until',
      value: '2026-07-31',
      before: 'not deferred',
    });
    expect(effectOf({ kind: 'task.due_in_days', days: 7 }, task(), MEMBERS, TODAY)).toMatchObject({
      field: 'due_on',
      value: '2026-08-04',
      before: 'no date',
    });
  });

  it('counts days forward across both clock changes without losing one', () => {
    expect(effectOf({ kind: 'task.due_in_days', days: 7 }, task(), MEMBERS, '2026-03-25')).toMatchObject({
      value: '2026-04-01',
    });
    expect(effectOf({ kind: 'task.due_in_days', days: 7 }, task(), MEMBERS, '2026-10-21')).toMatchObject({
      value: '2026-10-28',
    });
  });

  it('a notification carries a link to the item and never an external URL', () => {
    const e = effectOf({ kind: 'notify', message: 'Bins tonight' }, task(), MEMBERS, TODAY);
    expect(e).toMatchObject({ kind: 'notify', body: 'Bins tonight', href: '/tasks/t-1' });
    expect(e && 'href' in e && e.href.startsWith('/')).toBe(true);
  });

  it('a notification with no message falls back to the title', () => {
    expect(effectOf({ kind: 'notify' }, task({ title: 'Put the bins out' }), MEMBERS, TODAY)).toMatchObject({
      body: 'Put the bins out',
    });
  });

  it('a notification always produces an effect, because sending one is never a no-op', () => {
    expect(effectOf({ kind: 'notify' }, task(), MEMBERS, TODAY)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('a rule never acts on a locked item', () => {
  it('skips it with a stated reason rather than not matching', () => {
    const out = evaluate(rule(), task({ isLocked: true, title: '' }), MEMBERS, TODAY);
    expect(out.matched).toBe(false);
    expect(out.effects).toEqual([]);
    expect(out.skipped).toBe('locked');
    expect(out.reason).toMatch(/locked/);
  });

  it('skips it even when the conditions would match on whatever the caller passed', () => {
    // The failure this prevents: a caller that fetched the plaintext columns of
    // a locked row anyway, and got the empty strings the constraint guarantees.
    const out = evaluate(
      rule({ conditions: [] }),
      task({ isLocked: true, title: 'Put the bins out' }),
      MEMBERS,
      TODAY,
    );
    expect(out.skipped).toBe('locked');
    expect(out.effects).toEqual([]);
  });

  it('skips it before any action is even considered', () => {
    const out = evaluate(
      rule({ conditions: [], actions: [{ kind: 'notify', message: 'leak' }] }),
      task({ isLocked: true }),
      MEMBERS,
      TODAY,
    );
    expect(out.effects).toEqual([]);
  });
});

describe('a rule never acts across a space boundary', () => {
  it('skips a fact from another space, with a stated reason', () => {
    const out = evaluate(rule({ spaceId: HOME }), task({ spaceId: WORK }), MEMBERS, TODAY);
    expect(out.matched).toBe(false);
    expect(out.effects).toEqual([]);
    expect(out.skipped).toBe('cross_space');
    expect(out.reason).toMatch(/different space/);
  });

  it('skips it even with no conditions to fail on', () => {
    const out = evaluate(rule({ spaceId: HOME, conditions: [] }), task({ spaceId: WORK }), MEMBERS, TODAY);
    expect(out.skipped).toBe('cross_space');
  });

  it('checks locked first, so a locked item in the wrong space is still reported as locked', () => {
    const out = evaluate(rule({ spaceId: HOME }), task({ spaceId: WORK, isLocked: true }), MEMBERS, TODAY);
    expect(out.skipped).toBe('locked');
  });

  it('acts happily on a fact in its own space', () => {
    expect(evaluate(rule({ spaceId: WORK }), task({ spaceId: WORK }), MEMBERS, TODAY).matched).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('evaluating one rule against one task', () => {
  it('runs the seeded bins rule end to end', () => {
    const out = evaluate(rule(), task({ title: 'Put the bins out' }), MEMBERS, TODAY);
    expect(out.matched).toBe(true);
    expect(out.effects).toHaveLength(1);
    expect(out.effects[0].description).toContain('Assign “Put the bins out” to Danny');
  });

  it('runs the seeded overdue-admin rule end to end', () => {
    const r = rule({
      trigger: { kind: 'schedule', cron: '0 7 * * *' },
      conditions: [
        { field: 'category.slug', op: 'eq', value: 'admin' },
        { field: 'days_overdue', op: 'gte', value: 7 },
      ],
      actions: [{ kind: 'task.set_priority', priority: 'high' }],
    });
    const hit = evaluate(r, task({ categorySlug: 'admin', dueOn: '2026-07-01', priority: 'normal' }), MEMBERS, TODAY);
    expect(hit.matched).toBe(true);
    expect(hit.effects[0]).toMatchObject({ field: 'priority', value: 'high' });

    const miss = evaluate(r, task({ categorySlug: 'admin', dueOn: '2026-07-25' }), MEMBERS, TODAY);
    expect(miss.matched).toBe(false);
    expect(miss.reason).toBe('No match.');
  });

  it('matches with no effects when everything the rule wants is already true', () => {
    const out = evaluate(
      rule({ actions: [{ kind: 'task.assign', to: 'partner' }] }),
      task({ assigneeId: DANNY.id, assigneeName: 'Danny' }),
      MEMBERS,
      TODAY,
    );
    expect(out.matched).toBe(true);
    expect(out.effects).toEqual([]);
    expect(out.reason).toMatch(/already true/);
  });

  it('produces one effect per action that changes something', () => {
    const out = evaluate(
      rule({
        actions: [
          { kind: 'task.set_priority', priority: 'high' },
          { kind: 'task.assign', to: 'partner' },
          { kind: 'task.set_status', status: 'todo' }, // already true
          { kind: 'notify' },
        ] as Action[],
      }),
      task(),
      MEMBERS,
      TODAY,
    );
    expect(out.effects.map((e) => e.kind)).toEqual(['task.update', 'task.update', 'notify']);
  });

  it('is a pure function — evaluating twice gives the same answer and mutates nothing', () => {
    const f = task({ title: 'Put the bins out' });
    const snapshot = JSON.stringify(f);
    const a = evaluate(rule(), f, MEMBERS, TODAY);
    const b = evaluate(rule(), f, MEMBERS, TODAY);
    expect(a).toEqual(b);
    expect(JSON.stringify(f)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------

describe('a whole run', () => {
  const facts = [
    task({ id: 'a', title: 'Put the bins out' }),
    task({ id: 'b', title: 'Book the dentist' }),
    task({ id: 'c', title: 'Bin bags', isLocked: true }),
    task({ id: 'd', title: 'Bins at the office', spaceId: WORK }),
    task({ id: 'e', title: 'Bins again', assigneeId: DANNY.id, assigneeName: 'Danny' }),
  ];

  it('counts what it considered, matched, changed and skipped', () => {
    const run = evaluateAll(rule(), facts, MEMBERS, TODAY);
    expect(run.considered).toBe(5);
    expect(run.matched).toBe(2); // a and e; e already assigned
    expect(run.effects).toBe(1); // only a changes anything
    expect(run.skipped).toBe(2); // the locked one and the one in Work
  });

  it('keeps every item, including the ones that did not match', () => {
    // "Why did my rule not fire on that one" is the question the audit trail
    // exists to answer, so a non-match is a row, not a gap.
    const run = evaluateAll(rule(), facts, MEMBERS, TODAY);
    expect(run.items).toHaveLength(5);
    expect(run.items.map((i) => i.fact.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(run.items[1].outcome.reason).toBe('No match.');
  });

  it('says so in a sentence', () => {
    expect(evaluateAll(rule(), facts, MEMBERS, TODAY).headline).toBe(
      '5 items considered, 2 matched, 1 change, 2 skipped.',
    );
  });

  it('says there is nothing to consider rather than reporting zeroes', () => {
    expect(evaluateAll(rule(), [], MEMBERS, TODAY).headline).toMatch(/Nothing to consider/);
  });

  it('drops the skipped clause when nothing was skipped', () => {
    const run = evaluateAll(rule(), [facts[0], facts[1]], MEMBERS, TODAY);
    expect(run.headline).toBe('2 items considered, 1 matched, 1 change.');
  });

  it('a dry run and a real run compute exactly the same thing', () => {
    // There is no dry-run branch in this module, and that is the point: a
    // preview computed differently from the run is a preview of something else.
    const dry = evaluateAll(rule(), facts, MEMBERS, TODAY);
    const real = evaluateAll(rule(), facts, MEMBERS, TODAY);
    expect(dry).toEqual(real);
  });
});

// ---------------------------------------------------------------------------

describe('describing a rule to somebody who has to trust it', () => {
  it('describes a condition', () => {
    expect(describeCondition({ field: 'title', op: 'contains', value: 'bin' })).toBe('Title contains “bin”');
    expect(describeCondition({ field: 'days_overdue', op: 'gte', value: 7 })).toBe('Days overdue is at least “7”');
    expect(describeCondition({ field: 'assignee', op: 'is_empty' })).toBe('Assigned to is empty');
    expect(describeCondition({ field: 'title', op: 'eq', value: null })).toBe('Title is (nothing)');
  });

  it('describes an action', () => {
    expect(describeAction({ kind: 'task.set_priority', priority: 'high' })).toBe('set priority to high');
    expect(describeAction({ kind: 'task.assign', to: 'partner' })).toBe('assign it to my partner');
    expect(describeAction({ kind: 'task.assign', to: 'nobody' })).toBe('unassign it');
    expect(describeAction({ kind: 'task.defer_days', days: 1 })).toBe('defer it by 1 day');
    expect(describeAction({ kind: 'task.due_in_days', days: 0 })).toBe('make it due today');
    expect(describeAction({ kind: 'notify', message: 'Bins' })).toBe('notify me: “Bins”');
    expect(describeAction({ kind: 'notify' })).toBe('notify me');
  });

  it('describes the whole rule as one sentence', () => {
    expect(describeRule(rule())).toBe(
      'When a task is created and Title contains “bin” — assign it to my partner.',
    );
  });

  it('says out loud when a rule has no conditions', () => {
    expect(describeRule(rule({ conditions: [] }))).toContain('every task, with no conditions');
  });
});
