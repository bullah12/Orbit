/**
 * The rules engine.
 *
 * Pure, like src/lib/recurrence.ts and src/lib/travel.ts, and for the same
 * reason those two are: this is a bug farm. A rule is a small program somebody
 * wrote in a form, running unattended against their own data, and the failure
 * modes are silent — a condition that matches everything, an action that
 * rewrites a field nobody meant to change, a rule in one space reaching into
 * another. Every one of those is cheap to catch here and expensive to catch
 * through a page.
 *
 * Nothing in this file touches Postgres, the network or a provider. It takes a
 * **fact** — a flat snapshot of one entity, gathered by the caller — and a
 * **rule**, and answers two questions: did it match, and what would it change?
 * Applying the change is the caller's job (src/lib/queries/rules.ts); this
 * module never writes anything, which is what makes a dry run and a real run
 * literally the same code path with one boolean different.
 *
 * Two invariants are enforced here rather than trusted to the caller, because
 * they are the two that matter and a caller that forgets one is a disclosure:
 *
 *   1. **A rule never acts on a locked item.** Locked items are E2E encrypted
 *      (decision 1); the server holds ciphertext and has no plaintext to match
 *      a condition against. A rule that matched one would be matching on the
 *      absence of a title.
 *   2. **A rule never acts across a space boundary.** A rule belongs to a
 *      space. A rule firing in a space its owner cannot read is the same
 *      disclosure a bad policy would be, so the mismatch is a hard skip with a
 *      reason, not a filtered-out row.
 *
 * Both produce a *skip with a stated reason* rather than a silent non-match,
 * so `rule_runs` records that the engine saw the item and declined it.
 */

import { addDaysISO, daysFromToday, todayISO } from '@/lib/format';

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/**
 * What can start a run.
 *
 * `task.created`, `task.updated` and `task.completed` are *event* triggers:
 * one entity, evaluated the moment it changes. `schedule` is a *sweep*: every
 * open task in the rule's space, evaluated when the schedule comes round.
 * Deliberately narrow — every trigger here is one somebody can demonstrate.
 */
export const TRIGGER_KINDS = [
  'task.created',
  'task.updated',
  'task.completed',
  'schedule',
] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export const TRIGGER_LABEL: Record<TriggerKind, string> = {
  'task.created': 'When a task is created',
  'task.updated': 'When a task is changed',
  'task.completed': 'When a task is completed',
  schedule: 'On a schedule',
};

export type Trigger =
  | { kind: 'task.created' }
  | { kind: 'task.updated' }
  | { kind: 'task.completed' }
  /** A daily sweep. `cron` is stored and shown; only the hour field is honoured. */
  | { kind: 'schedule'; cron: string };

export function isTriggerKind(v: unknown): v is TriggerKind {
  return typeof v === 'string' && (TRIGGER_KINDS as readonly string[]).includes(v);
}

/** True when this trigger sweeps existing rows rather than reacting to one. */
export function isSweep(trigger: Trigger): boolean {
  return trigger.kind === 'schedule';
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/**
 * The fields a condition can read.
 *
 * A closed list, not "any column". A rule is written in a form by somebody who
 * is not writing SQL, and an open field list means a typo is a rule that
 * silently never matches. An unknown field is a *malformed rule*, reported as
 * such — see `validateRule`.
 */
export const CONDITION_FIELDS = {
  title: { label: 'Title', type: 'text' },
  body: { label: 'Body', type: 'text' },
  'category.slug': { label: 'Category', type: 'text' },
  priority: { label: 'Priority', type: 'text' },
  status: { label: 'Status', type: 'text' },
  assignee: { label: 'Assigned to', type: 'text' },
  days_overdue: { label: 'Days overdue', type: 'number' },
  days_until_due: { label: 'Days until due', type: 'number' },
  estimate_minutes: { label: 'Estimate (minutes)', type: 'number' },
  has_due_date: { label: 'Has a due date', type: 'boolean' },
} as const;

export type ConditionField = keyof typeof CONDITION_FIELDS;

export const CONDITION_OPS = {
  eq: { label: 'is' },
  neq: { label: 'is not' },
  contains: { label: 'contains' },
  not_contains: { label: 'does not contain' },
  gte: { label: 'is at least' },
  lte: { label: 'is at most' },
  gt: { label: 'is more than' },
  lt: { label: 'is less than' },
  is_set: { label: 'is set' },
  is_empty: { label: 'is empty' },
} as const;

export type ConditionOp = keyof typeof CONDITION_OPS;

export type Condition = {
  field: ConditionField;
  op: ConditionOp;
  value?: string | number | boolean | null;
};

/** Conditions are ANDed. There is no OR and no nesting: see docs/decisions-log.md. */
export type Conditions = Condition[];

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const PRIORITIES = ['none', 'low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const STATUSES = ['todo', 'doing', 'blocked', 'done', 'dropped'] as const;
export type Status = (typeof STATUSES)[number];

/**
 * `partner` and `me` are resolved by the caller against the space's membership,
 * never by an id typed into a rule: an id in a rule is an id that outlives the
 * membership it referred to.
 */
export const ASSIGNEE_REFS = ['me', 'partner', 'nobody'] as const;
export type AssigneeRef = (typeof ASSIGNEE_REFS)[number];

export type Action =
  | { kind: 'task.set_priority'; priority: Priority }
  | { kind: 'task.set_status'; status: Status }
  | { kind: 'task.assign'; to: AssigneeRef }
  | { kind: 'task.defer_days'; days: number }
  | { kind: 'task.due_in_days'; days: number }
  | { kind: 'notify'; message?: string };

export const ACTION_KINDS = [
  'task.set_priority',
  'task.set_status',
  'task.assign',
  'task.defer_days',
  'task.due_in_days',
  'notify',
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

/**
 * One task, flattened to exactly what a condition can read plus what an effect
 * needs in order to describe itself.
 *
 * `spaceId` is here so the evaluator can refuse a cross-space rule, and
 * `isLocked` so it can refuse a locked one. Neither is a condition field: you
 * cannot write "if locked", because the answer is always no.
 */
export type TaskFact = {
  kind: 'task';
  id: string;
  spaceId: string;
  isLocked: boolean;
  title: string;
  body: string;
  status: Status;
  priority: Priority;
  categorySlug: string | null;
  /** Display name of the assignee; null when unassigned. */
  assigneeName: string | null;
  assigneeId: string | null;
  dueOn: string | null;
  deferredUntil: string | null;
  estimateMinutes: number | null;
};

export type Fact = TaskFact;

/** What the caller must supply so `me` and `partner` mean somebody. */
export type Members = {
  /** The rule's owner. */
  me: { id: string; name: string };
  /** The other member of the space, when there is exactly one. */
  partner: { id: string; name: string } | null;
};

export type Rule = {
  id: string;
  spaceId: string;
  name: string;
  trigger: Trigger;
  conditions: Conditions;
  actions: Action[];
  isEnabled: boolean;
};

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/**
 * A change a run made, or would have made.
 *
 * `before`/`after` are strings because this is what a person reads in a preview
 * and in the audit trail, not what the writer applies — the writer reads
 * `field` and `value`. `description` is the whole point of the dry run: a rule
 * is only safe to enable if somebody has read, in a sentence, exactly what it
 * is about to do.
 */
export type Effect =
  | {
      kind: 'task.update';
      field: 'priority' | 'status' | 'assignee_id' | 'deferred_until' | 'due_on';
      value: string | null;
      before: string;
      after: string;
      description: string;
    }
  | {
      kind: 'notify';
      title: string;
      body: string;
      href: string;
      description: string;
    };

/** Why a rule declined an item, when it declined it for a reason worth recording. */
export type SkipReason = 'locked' | 'cross_space' | 'malformed' | 'trigger';

export type Outcome = {
  matched: boolean;
  /** Empty when `matched` is false, and also when the item already looks as the rule wants. */
  effects: Effect[];
  skipped: SkipReason | null;
  /** Plain language, shown in the preview and stored on the run. */
  reason: string;
};

// ---------------------------------------------------------------------------
// Parsing — everything below the app boundary is jsonb, so it is `unknown`
// ---------------------------------------------------------------------------

export class RuleShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleShapeError';
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function parseTrigger(raw: unknown): Trigger {
  const o = asRecord(raw);
  if (!o) throw new RuleShapeError('a trigger must be an object');
  const kind = o.kind;
  if (!isTriggerKind(kind)) throw new RuleShapeError(`unknown trigger kind: ${String(kind)}`);
  if (kind === 'schedule') {
    const cron = typeof o.cron === 'string' && o.cron.trim() ? o.cron.trim() : '0 7 * * *';
    return { kind, cron };
  }
  return { kind };
}

export function parseConditions(raw: unknown): Conditions {
  if (!Array.isArray(raw)) throw new RuleShapeError('conditions must be an array');
  return raw.map((item, i) => {
    const o = asRecord(item);
    if (!o) throw new RuleShapeError(`condition ${i + 1} must be an object`);
    const field = o.field;
    if (typeof field !== 'string' || !(field in CONDITION_FIELDS)) {
      throw new RuleShapeError(`condition ${i + 1} reads a field Orbit does not know: ${String(field)}`);
    }
    const op = o.op;
    if (typeof op !== 'string' || !(op in CONDITION_OPS)) {
      throw new RuleShapeError(`condition ${i + 1} uses an operator Orbit does not know: ${String(op)}`);
    }
    const value = o.value === undefined ? null : (o.value as Condition['value']);
    return { field: field as ConditionField, op: op as ConditionOp, value };
  });
}

export function parseActions(raw: unknown): Action[] {
  if (!Array.isArray(raw)) throw new RuleShapeError('actions must be an array');
  return raw.map((item, i) => {
    const o = asRecord(item);
    if (!o) throw new RuleShapeError(`action ${i + 1} must be an object`);
    const kind = o.kind;
    switch (kind) {
      case 'task.set_priority': {
        const priority = o.priority;
        if (typeof priority !== 'string' || !(PRIORITIES as readonly string[]).includes(priority)) {
          throw new RuleShapeError(`action ${i + 1} sets an unknown priority: ${String(priority)}`);
        }
        return { kind, priority: priority as Priority };
      }
      case 'task.set_status': {
        const status = o.status;
        if (typeof status !== 'string' || !(STATUSES as readonly string[]).includes(status)) {
          throw new RuleShapeError(`action ${i + 1} sets an unknown status: ${String(status)}`);
        }
        return { kind, status: status as Status };
      }
      case 'task.assign': {
        const to = o.to;
        if (typeof to !== 'string' || !(ASSIGNEE_REFS as readonly string[]).includes(to)) {
          throw new RuleShapeError(`action ${i + 1} assigns to somebody Orbit cannot resolve: ${String(to)}`);
        }
        return { kind, to: to as AssigneeRef };
      }
      case 'task.defer_days':
      case 'task.due_in_days': {
        const days = Number(o.days);
        if (!Number.isFinite(days) || !Number.isInteger(days) || days < 0 || days > 3650) {
          throw new RuleShapeError(`action ${i + 1} needs a whole number of days between 0 and 3650`);
        }
        return { kind, days };
      }
      case 'notify': {
        const message = typeof o.message === 'string' ? o.message : undefined;
        return { kind, message };
      }
      default:
        throw new RuleShapeError(`unknown action: ${String(kind)}`);
    }
  });
}

/**
 * Everything wrong with a rule, in one list, so a form can show all of it at
 * once rather than one error per save.
 */
export function validateRule(raw: {
  trigger: unknown;
  conditions: unknown;
  actions: unknown;
}): string[] {
  const problems: string[] = [];
  let actions: Action[] = [];
  for (const [what, parse] of [
    ['trigger', () => parseTrigger(raw.trigger)],
    ['conditions', () => parseConditions(raw.conditions)],
    ['actions', () => { actions = parseActions(raw.actions); }],
  ] as const) {
    try {
      parse();
    } catch (err) {
      problems.push(err instanceof RuleShapeError ? err.message : `${what} is malformed`);
    }
  }
  if (!problems.length && actions.length === 0) {
    problems.push('a rule with no actions would never do anything');
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Conditions — matching
// ---------------------------------------------------------------------------

/** The value a field reads on a fact. `null` means "not set". */
export function readField(
  fact: TaskFact,
  field: ConditionField,
  today: string = todayISO(),
): string | number | boolean | null {
  switch (field) {
    case 'title':
      return fact.title;
    case 'body':
      return fact.body;
    case 'category.slug':
      return fact.categorySlug;
    case 'priority':
      return fact.priority;
    case 'status':
      return fact.status;
    case 'assignee':
      return fact.assigneeName;
    case 'days_overdue':
      // Positive when the date has passed. Null — not zero — when there is no
      // date at all, so `days_overdue >= 7` never matches an undated task.
      // The arguments are swapped rather than the result negated: negating zero
      // gives -0, which is equal to 0 everywhere except in a test assertion.
      return fact.dueOn ? daysFromToday(today, fact.dueOn) : null;
    case 'days_until_due':
      return fact.dueOn ? daysFromToday(fact.dueOn, today) : null;
    case 'estimate_minutes':
      return fact.estimateMinutes;
    case 'has_due_date':
      return fact.dueOn !== null;
  }
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

/**
 * One condition against one fact.
 *
 * Text comparisons are case-insensitive and trimmed, because the alternative is
 * a rule that quietly stops matching when somebody types "Bins" instead of
 * "bins". Numeric comparisons on an unset field are always false: an undated
 * task is not zero days overdue.
 */
export function matchCondition(
  fact: TaskFact,
  condition: Condition,
  today: string = todayISO(),
): boolean {
  const actual = readField(fact, condition.field, today);
  const expected = condition.value ?? null;

  switch (condition.op) {
    case 'is_set':
      return actual !== null && actual !== '';
    case 'is_empty':
      return actual === null || actual === '';
    case 'eq':
      if (typeof actual === 'boolean' || typeof expected === 'boolean') {
        return toText(actual).toLowerCase() === toText(expected).toLowerCase();
      }
      return toText(actual).trim().toLowerCase() === toText(expected).trim().toLowerCase();
    case 'neq':
      return !matchCondition(fact, { ...condition, op: 'eq' }, today);
    case 'contains':
      if (actual === null) return false;
      return toText(actual).toLowerCase().includes(toText(expected).trim().toLowerCase());
    case 'not_contains':
      if (actual === null) return true;
      return !toText(actual).toLowerCase().includes(toText(expected).trim().toLowerCase());
    case 'gte':
    case 'lte':
    case 'gt':
    case 'lt': {
      const a = toNumber(actual);
      const b = toNumber(expected);
      if (a === null || b === null) return false;
      if (condition.op === 'gte') return a >= b;
      if (condition.op === 'lte') return a <= b;
      if (condition.op === 'gt') return a > b;
      return a < b;
    }
  }
}

/** All conditions, ANDed. No conditions means "everything", which is legal and loud in the UI. */
export function matchConditions(
  fact: TaskFact,
  conditions: Conditions,
  today: string = todayISO(),
): boolean {
  return conditions.every((c) => matchCondition(fact, c, today));
}

// ---------------------------------------------------------------------------
// Actions — effects
// ---------------------------------------------------------------------------

const PRIORITY_LABEL: Record<Priority, string> = {
  none: 'no priority',
  low: 'low',
  normal: 'normal',
  high: 'high',
  urgent: 'urgent',
};

const STATUS_LABEL: Record<Status, string> = {
  todo: 'to do',
  doing: 'in progress',
  blocked: 'blocked',
  done: 'done',
  dropped: 'dropped',
};

function resolveAssignee(to: AssigneeRef, members: Members): { id: string | null; name: string } {
  if (to === 'nobody') return { id: null, name: 'nobody' };
  if (to === 'me') return { id: members.me.id, name: members.me.name };
  return members.partner
    ? { id: members.partner.id, name: members.partner.name }
    : { id: null, name: '' };
}

/**
 * What one action would do to one fact — or nothing, when the fact already
 * looks the way the action wants.
 *
 * That "or nothing" is load-bearing. A scheduled rule sweeps the same rows
 * every morning; if setting a priority that is already high counted as an
 * effect, the audit trail would fill with changes that changed nothing and the
 * run count would be a measure of how long the rule had existed.
 */
export function effectOf(
  action: Action,
  fact: TaskFact,
  members: Members,
  today: string = todayISO(),
): Effect | null {
  switch (action.kind) {
    case 'task.set_priority': {
      if (fact.priority === action.priority) return null;
      return {
        kind: 'task.update',
        field: 'priority',
        value: action.priority,
        before: PRIORITY_LABEL[fact.priority],
        after: PRIORITY_LABEL[action.priority],
        description: `Set “${fact.title}” to ${PRIORITY_LABEL[action.priority]} priority (it is ${PRIORITY_LABEL[fact.priority]} now)`,
      };
    }
    case 'task.set_status': {
      if (fact.status === action.status) return null;
      return {
        kind: 'task.update',
        field: 'status',
        value: action.status,
        before: STATUS_LABEL[fact.status],
        after: STATUS_LABEL[action.status],
        description: `Move “${fact.title}” to ${STATUS_LABEL[action.status]} (it is ${STATUS_LABEL[fact.status]} now)`,
      };
    }
    case 'task.assign': {
      const target = resolveAssignee(action.to, members);
      // "the partner" in a space with nobody else in it. Silently assigning to
      // the owner instead would be a rule doing something it does not say.
      if (action.to === 'partner' && !members.partner) return null;
      if ((fact.assigneeId ?? null) === target.id) return null;
      const before = fact.assigneeName ?? 'nobody';
      return {
        kind: 'task.update',
        field: 'assignee_id',
        value: target.id,
        before,
        after: target.name,
        description: `Assign “${fact.title}” to ${target.name} (it is with ${before} now)`,
      };
    }
    case 'task.defer_days': {
      const until = addDaysISO(today, action.days);
      const before = fact.deferredUntil ? fact.deferredUntil.slice(0, 10) : 'not deferred';
      if (before === until) return null;
      return {
        kind: 'task.update',
        field: 'deferred_until',
        value: until,
        before,
        after: until,
        description: `Defer “${fact.title}” until ${until} (${before} now)`,
      };
    }
    case 'task.due_in_days': {
      const due = addDaysISO(today, action.days);
      const before = fact.dueOn ?? 'no date';
      if (fact.dueOn === due) return null;
      return {
        kind: 'task.update',
        field: 'due_on',
        value: due,
        before,
        after: due,
        description: `Set the due date of “${fact.title}” to ${due} (${before} now)`,
      };
    }
    case 'notify': {
      const body = action.message?.trim() || fact.title;
      return {
        kind: 'notify',
        title: 'Orbit',
        body,
        href: `/tasks/${fact.id}`,
        description: `Send a notification: “${body}”`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// The evaluator
// ---------------------------------------------------------------------------

/**
 * One rule against one fact. This is the whole engine.
 *
 * A dry run and a real run call this identically; the only difference is
 * whether the caller applies what comes back. That is deliberate — a preview
 * that used a different code path from the run would be a preview of something
 * else.
 */
export function evaluate(
  rule: Rule,
  fact: Fact,
  members: Members,
  today: string = todayISO(),
): Outcome {
  // 1. A rule never acts on a locked item. The server has no plaintext to
  //    match against, so a match would be a match on emptiness.
  if (fact.isLocked) {
    return {
      matched: false,
      effects: [],
      skipped: 'locked',
      reason: 'Skipped: the item is locked, and a rule never reads a locked item.',
    };
  }

  // 2. A rule never acts across a space boundary, whatever the caller passed.
  if (fact.spaceId !== rule.spaceId) {
    return {
      matched: false,
      effects: [],
      skipped: 'cross_space',
      reason: 'Skipped: the item is in a different space from the rule.',
    };
  }

  if (!matchConditions(fact, rule.conditions, today)) {
    return { matched: false, effects: [], skipped: null, reason: 'No match.' };
  }

  const effects = rule.actions
    .map((a) => effectOf(a, fact, members, today))
    .filter((e): e is Effect => e !== null);

  return {
    matched: true,
    effects,
    skipped: null,
    reason: effects.length
      ? `Matched, ${effects.length} ${effects.length === 1 ? 'change' : 'changes'}.`
      : 'Matched, but everything the rule wants is already true.',
  };
}

export type RunItem = {
  fact: Fact;
  outcome: Outcome;
};

export type RunSummary = {
  ruleId: string;
  considered: number;
  matched: number;
  skipped: number;
  effects: number;
  items: RunItem[];
  /** One sentence for the top of a preview. */
  headline: string;
};

/**
 * A whole run — every candidate fact, in order, with what each produced.
 *
 * Skipped and non-matching items stay in `items` rather than being filtered
 * away: "why did my rule not fire on that one" is the question the audit trail
 * exists to answer.
 */
export function evaluateAll(
  rule: Rule,
  facts: Fact[],
  members: Members,
  today: string = todayISO(),
): RunSummary {
  const items = facts.map((fact) => ({ fact, outcome: evaluate(rule, fact, members, today) }));
  const matched = items.filter((i) => i.outcome.matched).length;
  const skipped = items.filter((i) => i.outcome.skipped !== null).length;
  const effects = items.reduce((n, i) => n + i.outcome.effects.length, 0);
  return {
    ruleId: rule.id,
    considered: items.length,
    matched,
    skipped,
    effects,
    items,
    headline: headlineFor(items.length, matched, effects, skipped),
  };
}

function headlineFor(considered: number, matched: number, effects: number, skipped: number): string {
  if (considered === 0) return 'Nothing to consider — no item this rule could apply to.';
  const parts = [
    `${considered} ${considered === 1 ? 'item' : 'items'} considered`,
    `${matched} matched`,
    `${effects} ${effects === 1 ? 'change' : 'changes'}`,
  ];
  if (skipped) parts.push(`${skipped} skipped`);
  return `${parts.join(', ')}.`;
}

// ---------------------------------------------------------------------------
// Describing a rule in a sentence
// ---------------------------------------------------------------------------

function describeValue(v: Condition['value']): string {
  if (v === null || v === undefined || v === '') return '(nothing)';
  return `“${String(v)}”`;
}

export function describeCondition(c: Condition): string {
  const field = CONDITION_FIELDS[c.field].label;
  const op = CONDITION_OPS[c.op].label;
  if (c.op === 'is_set' || c.op === 'is_empty') return `${field} ${op}`;
  return `${field} ${op} ${describeValue(c.value)}`;
}

export function describeAction(a: Action): string {
  switch (a.kind) {
    case 'task.set_priority':
      return `set priority to ${PRIORITY_LABEL[a.priority]}`;
    case 'task.set_status':
      return `move it to ${STATUS_LABEL[a.status]}`;
    case 'task.assign':
      return a.to === 'nobody' ? 'unassign it' : `assign it to ${a.to === 'me' ? 'me' : 'my partner'}`;
    case 'task.defer_days':
      return a.days === 0 ? 'clear the deferral' : `defer it by ${a.days} ${a.days === 1 ? 'day' : 'days'}`;
    case 'task.due_in_days':
      return a.days === 0 ? 'make it due today' : `make it due in ${a.days} ${a.days === 1 ? 'day' : 'days'}`;
    case 'notify':
      return a.message?.trim() ? `notify me: “${a.message.trim()}”` : 'notify me';
  }
}

/** The whole rule as one line, for a list row. Never truncated by this function. */
export function describeRule(rule: Rule): string {
  const when = TRIGGER_LABEL[rule.trigger.kind].toLowerCase();
  const conds = rule.conditions.length
    ? ` and ${rule.conditions.map(describeCondition).join(', and ')}`
    : ' (every task, with no conditions)';
  const acts = rule.actions.length ? rule.actions.map(describeAction).join(', then ') : 'do nothing';
  return `${when[0].toUpperCase()}${when.slice(1)}${conds} — ${acts}.`;
}
