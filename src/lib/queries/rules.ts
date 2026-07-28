import 'server-only';
import { asUser, type Tx } from '@/lib/db';
import type { SpaceRef } from '@/components/SpaceIndicator';
import { todayISO } from '@/lib/format';
import {
  RuleShapeError,
  evaluateAll,
  parseActions,
  parseConditions,
  parseTrigger,
  type Effect,
  type Fact,
  type Members,
  type Action,
  type Conditions,
  type Rule,
  type RunSummary,
  type Trigger,
  type TaskFact,
  type TriggerKind,
} from '@/lib/rules';
import { pushProvider } from '@/lib/integrations';

/**
 * The rules engine's database side.
 *
 * The evaluator itself is pure and lives in src/lib/rules.ts. This module does
 * the three things it cannot: gather the candidate facts, apply the effects,
 * and write the audit trail.
 *
 * Everything here runs through `asUser`, so RLS is what decides which rules
 * exist and which tasks a rule can see. The engine has no elevated path — a
 * rule in a space the caller cannot read simply is not returned by
 * `listRules`, and a task in another space is never gathered as a fact. The
 * evaluator's own cross-space refusal is a second line, not the only one.
 */

export type RuleRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  trigger: unknown;
  conditions: unknown;
  actions: unknown;
  isEnabled: boolean;
  lastDryRunAt: string | null;
  lastRunAt: string | null;
  runCount: number;
  spaceId: string;
  space: SpaceRef;
};

const RULE_SELECT = `
  r.id, r.name, r.slug, r.description,
  r.trigger, r.conditions, r.actions,
  r.is_enabled       as "isEnabled",
  r.last_dry_run_at  as "lastDryRunAt",
  r.last_run_at      as "lastRunAt",
  r.run_count        as "runCount",
  r.space_id         as "spaceId",
  jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                     'colour', s.colour, 'icon', s.icon) as space
`;

export async function listRules(userId: string): Promise<RuleRow[]> {
  return asUser(userId, async (tx) => {
    return tx<RuleRow[]>`
      select ${tx.unsafe(RULE_SELECT)}
      from public.rules r
      join public.spaces s on s.id = r.space_id
      order by r.is_enabled desc, r.name
      limit 200
    `;
  });
}

export async function getRule(userId: string, id: string): Promise<RuleRow | null> {
  return asUser(userId, async (tx) => {
    const [row] = await tx<RuleRow[]>`
      select ${tx.unsafe(RULE_SELECT)}
      from public.rules r
      join public.spaces s on s.id = r.space_id
      where r.id = ${id}::uuid
    `;
    return row ?? null;
  });
}

/**
 * A stored rule, parsed.
 *
 * Returns the problems rather than throwing, because a malformed rule must
 * still render — a rule you cannot see is a rule you cannot fix, and the row
 * that will not parse is exactly the one somebody needs to open.
 */
export function parseRuleRow(row: RuleRow): { rule: Rule | null; problems: string[] } {
  const problems: string[] = [];
  try {
    const rule: Rule = {
      id: row.id,
      spaceId: row.spaceId,
      name: row.name,
      trigger: parseTrigger(row.trigger),
      conditions: parseConditions(row.conditions),
      actions: parseActions(row.actions),
      isEnabled: row.isEnabled,
    };
    return { rule, problems };
  } catch (err) {
    problems.push(err instanceof RuleShapeError ? err.message : 'the rule is malformed');
    return { rule: null, problems };
  }
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

type TaskFactRow = Omit<TaskFact, 'kind'>;

const FACT_SELECT = `
  t.id,
  t.space_id                    as "spaceId",
  t.is_locked                   as "isLocked",
  t.title,
  t.body_md                     as body,
  t.status::text                as status,
  t.priority::text              as priority,
  c.slug                        as "categorySlug",
  a.display_name                as "assigneeName",
  t.assignee_id                 as "assigneeId",
  t.due_on                      as "dueOn",
  t.deferred_until              as "deferredUntil",
  t.estimate_minutes            as "estimateMinutes"
`;

/**
 * The tasks a rule could act on.
 *
 * `space_id = rule.space_id` is not a substitute for the policy — RLS already
 * limits this to spaces the caller reads — it is the statement that a rule's
 * blast radius is its own space. Locked tasks are gathered but never acted on:
 * the evaluator skips them with a reason, and the preview says so, which is
 * more honest than a filter that makes them vanish.
 *
 * Completed and dropped tasks are out of scope for a sweep. A rule that
 * rewrites finished work is a rule that rewrites history.
 */
async function gatherTaskFacts(
  tx: Tx,
  spaceId: string,
  opts: { taskId?: string },
): Promise<TaskFact[]> {
  const rows = opts.taskId
    ? await tx<TaskFactRow[]>`
        select ${tx.unsafe(FACT_SELECT)}
        from public.tasks t
        left join public.categories c on c.id = t.category_id
        left join public.profiles a on a.id = t.assignee_id
        where t.id = ${opts.taskId}::uuid and t.space_id = ${spaceId}::uuid
      `
    : await tx<TaskFactRow[]>`
        select ${tx.unsafe(FACT_SELECT)}
        from public.tasks t
        left join public.categories c on c.id = t.category_id
        left join public.profiles a on a.id = t.assignee_id
        where t.space_id = ${spaceId}::uuid
          and t.status in ('todo','doing','blocked')
        order by t.due_on nulls last, t.created_at
        limit 500
      `;
  return rows.map((r) => ({ ...r, kind: 'task' as const }));
}

/**
 * Who `me` and `partner` mean in this space.
 *
 * `partner` is the other writing member when there is exactly one. Two other
 * members and the rule has no unambiguous partner, so it resolves to nobody
 * and the action does nothing rather than picking one — which is the light
 * participant model (decision 2) showing through: one power user, one
 * occasional viewer.
 */
async function membersOf(tx: Tx, spaceId: string, userId: string): Promise<Members> {
  const rows = await tx<{ id: string; name: string }[]>`
    select p.id, p.display_name as name
    from public.space_members m
    join public.profiles p on p.id = m.user_id
    where m.space_id = ${spaceId}::uuid
      and m.status = 'active'
      and m.role in ('owner','admin','member')
    order by p.display_name
  `;
  const me = rows.find((r) => r.id === userId) ?? { id: userId, name: 'me' };
  const others = rows.filter((r) => r.id !== userId);
  return { me, partner: others.length === 1 ? others[0] : null };
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export type RunResult = {
  summary: RunSummary;
  isDryRun: boolean;
  /** Notifications actually handed to the push provider. Empty on a dry run. */
  notified: number;
  /** Rows written to tasks. Zero on a dry run, by construction. */
  applied: number;
  providerName: string;
  durationMs: number;
};

/**
 * Run one rule — as a dry run, or for real.
 *
 * The two differ in exactly one place: whether `applyEffect` is called. The
 * evaluation, the audit row and the numbers on the screen are computed by the
 * same code either way, which is what makes the preview trustworthy.
 *
 * `triggerKind` is what the run is recorded as. A dry run of an event-triggered
 * rule sweeps its space so there is something to preview — a rule you can only
 * preview by creating a task is a rule you cannot preview.
 */
export async function runRule(
  userId: string,
  ruleId: string,
  opts: { dryRun: boolean; taskId?: string; today?: string } = { dryRun: true },
): Promise<RunResult | { error: string }> {
  const started = Date.now();
  const today = opts.today ?? todayISO();
  const row = await getRule(userId, ruleId);
  if (!row) return { error: 'That rule does not exist, or is not yours to run.' };

  const { rule, problems } = parseRuleRow(row);
  if (!rule) {
    await recordRun(userId, row, {
      isDryRun: opts.dryRun,
      triggerKind: 'malformed',
      matched: false,
      effects: [],
      error: problems.join('; '),
      durationMs: Date.now() - started,
    });
    return { error: problems.join('; ') };
  }

  if (!opts.dryRun && !rule.isEnabled) {
    return { error: 'That rule is disabled. Enable it before running it for real.' };
  }

  const provider = pushProvider();

  return asUser(userId, async (tx) => {
    const members = await membersOf(tx, rule.spaceId, userId);
    // An event-triggered rule run for real is given the one task that changed.
    // A dry run of the same rule sweeps its space, because a rule you can only
    // preview by creating a task is a rule you cannot preview.
    const facts: Fact[] = await gatherTaskFacts(tx, rule.spaceId, { taskId: opts.taskId });

    const summary = evaluateAll(rule, facts, members, today);

    let applied = 0;
    let notified = 0;
    if (!opts.dryRun) {
      for (const item of summary.items) {
        for (const effect of item.outcome.effects) {
          if (effect.kind === 'task.update') {
            applied += await applyTaskEffect(tx, item.fact.id, item.fact.spaceId, effect);
          } else {
            notified += await deliverNotification(tx, userId, item.fact, effect, provider);
          }
        }
      }
    }

    await recordRunTx(tx, userId, row, {
      isDryRun: opts.dryRun,
      triggerKind: rule.trigger.kind,
      matched: summary.matched > 0,
      effects: summary,
      error: null,
      durationMs: Date.now() - started,
    });

    if (opts.dryRun) {
      await tx`update public.rules set last_dry_run_at = now() where id = ${rule.id}::uuid`;
    } else {
      await tx`
        update public.rules
        set last_run_at = now(), run_count = run_count + 1
        where id = ${rule.id}::uuid
      `;
    }

    return {
      summary,
      isDryRun: opts.dryRun,
      notified,
      applied,
      providerName: provider.name,
      durationMs: Date.now() - started,
    };
  });
}

/**
 * Apply one update.
 *
 * `space_id = ` in the where clause is belt and braces on top of RLS: the same
 * statement that says a rule cannot reach outside its space, said again where
 * the write happens. `is_locked = false` is not belt and braces — it is the
 * last place a locked row could be touched by a code path that skipped the
 * evaluator, and the constraint on the table means a locked row has no title
 * to have matched in the first place.
 */
async function applyTaskEffect(
  tx: Tx,
  taskId: string,
  spaceId: string,
  effect: Extract<Effect, { kind: 'task.update' }>,
): Promise<number> {
  const guard = (result: { count: number }) => result.count;
  switch (effect.field) {
    case 'priority':
      return guard(await tx`
        update public.tasks set priority = ${effect.value}::app.priority
        where id = ${taskId}::uuid and space_id = ${spaceId}::uuid and not is_locked
      `);
    case 'status': {
      // `tasks_done_has_completed_at` means moving to done has to set the
      // timestamp in the same statement, and moving away has to clear it.
      const done = effect.value === 'done';
      return guard(await tx`
        update public.tasks
        set status = ${effect.value}::app.task_status,
            completed_at = case when ${done} then coalesce(completed_at, now()) else null end
        where id = ${taskId}::uuid and space_id = ${spaceId}::uuid and not is_locked
      `);
    }
    case 'assignee_id':
      return guard(await tx`
        update public.tasks set assignee_id = ${effect.value}::uuid
        where id = ${taskId}::uuid and space_id = ${spaceId}::uuid and not is_locked
      `);
    case 'deferred_until':
      return guard(await tx`
        update public.tasks set deferred_until = ${effect.value}::date
        where id = ${taskId}::uuid and space_id = ${spaceId}::uuid and not is_locked
      `);
    case 'due_on':
      return guard(await tx`
        update public.tasks set due_on = ${effect.value}::date
        where id = ${taskId}::uuid and space_id = ${spaceId}::uuid and not is_locked
      `);
  }
}

/**
 * Send one notification and record the delivery.
 *
 * The delivery row is written whatever the provider says, including when it
 * refuses — a notification that was never sent is a fact worth keeping, and it
 * is the only way to tell "the rule did not fire" from "the rule fired and the
 * push went nowhere". The default provider is an in-memory outbox, so nothing
 * leaves the machine.
 */
async function deliverNotification(
  tx: Tx,
  userId: string,
  fact: Fact,
  effect: Extract<Effect, { kind: 'notify' }>,
  provider: { name: string; send: (ref: string, m: { title: string; body: string; href?: string }) => Promise<{ delivered: boolean }> },
): Promise<number> {
  const [device] = await tx<{ id: string }[]>`
    select id from public.devices
    where space_id = ${fact.spaceId}::uuid and owner_id = ${userId}::uuid
    order by last_seen_at desc nulls last limit 1
  `;

  let status: 'sent' | 'failed' = 'sent';
  let error: string | null = null;
  try {
    const result = await provider.send(device?.id ?? `user:${userId}`, {
      title: effect.title,
      body: effect.body,
      href: effect.href,
    });
    if (!result.delivered) {
      status = 'failed';
      error = 'the provider accepted the message and did not deliver it';
    }
  } catch (err) {
    status = 'failed';
    error = err instanceof Error ? err.message : String(err);
  }

  await tx`
    insert into public.notification_deliveries
      (space_id, owner_id, device_id, channel, status, provider, error, attempts, sent_at)
    values (${fact.spaceId}::uuid, ${userId}::uuid, ${device?.id ?? null}, 'push',
            ${status}, ${provider.name}, ${error}, 1,
            ${status === 'sent' ? new Date().toISOString() : null})
  `;
  return status === 'sent' ? 1 : 0;
}

// ---------------------------------------------------------------------------
// The audit trail
// ---------------------------------------------------------------------------

type RecordArgs = {
  isDryRun: boolean;
  triggerKind: string;
  matched: boolean;
  effects: RunSummary | Effect[];
  error: string | null;
  durationMs: number;
};

/**
 * One row per run, dry or not.
 *
 * Dry runs are recorded on purpose. "What was I shown before I enabled this"
 * is exactly the question somebody asks after a rule does something they did
 * not expect, and an audit trail that only holds the real runs cannot answer
 * it.
 *
 * The row records every item the run considered, not only the ones that
 * matched, so "why did it not fire on that one" is answerable too.
 */
async function recordRunTx(tx: Tx, userId: string, row: RuleRow, args: RecordArgs): Promise<void> {
  const summary = Array.isArray(args.effects) ? null : args.effects;
  const effects = summary
    ? summary.items.map((i) => ({
        entity: i.fact.id,
        title: i.fact.isLocked ? '(locked)' : i.fact.title,
        matched: i.outcome.matched,
        skipped: i.outcome.skipped,
        reason: i.outcome.reason,
        changes: i.outcome.effects.map((e) => ({
          kind: e.kind,
          description: e.description,
          before: e.kind === 'task.update' ? e.before : null,
          after: e.kind === 'task.update' ? e.after : null,
        })),
      }))
    : [];

  // One item per run when a single entity triggered it; null for a sweep.
  const single = summary && summary.items.length === 1 ? summary.items[0].fact.id : null;

  await tx`
    insert into public.rule_runs
      (space_id, owner_id, rule_id, is_dry_run, trigger_kind, entity_kind, entity_id,
       matched, effects, error, duration_ms)
    values (${row.spaceId}::uuid, ${userId}::uuid, ${row.id}::uuid, ${args.isDryRun},
            ${args.triggerKind}, ${single ? 'task' : null}::app.entity_kind, ${single}::uuid,
            ${args.matched}, ${tx.json(effects)}, ${args.error}, ${args.durationMs})
  `;
}

async function recordRun(userId: string, row: RuleRow, args: RecordArgs): Promise<void> {
  await asUser(userId, async (tx) => recordRunTx(tx, userId, row, args));
}

export type RuleRunRow = {
  id: string;
  isDryRun: boolean;
  triggerKind: string;
  matched: boolean;
  effects: {
    entity: string;
    title: string;
    matched: boolean;
    skipped: string | null;
    reason: string;
    changes: { kind: string; description: string; before: string | null; after: string | null }[];
  }[];
  error: string | null;
  durationMs: number | null;
  ranAt: string;
  ruleId: string;
  ruleName: string;
  space: SpaceRef;
};

export async function listRuleRuns(
  userId: string,
  opts: { ruleId?: string; limit?: number } = {},
): Promise<RuleRunRow[]> {
  const limit = opts.limit ?? 25;
  return asUser(userId, async (tx) => {
    const where = opts.ruleId ? tx`where rr.rule_id = ${opts.ruleId}::uuid` : tx``;
    return tx<RuleRunRow[]>`
      select
        rr.id,
        rr.is_dry_run   as "isDryRun",
        rr.trigger_kind as "triggerKind",
        rr.matched,
        rr.effects,
        rr.error,
        rr.duration_ms  as "durationMs",
        rr.ran_at       as "ranAt",
        rr.rule_id      as "ruleId",
        r.name          as "ruleName",
        jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                           'colour', s.colour, 'icon', s.icon) as space
      from public.rule_runs rr
      join public.rules r on r.id = rr.rule_id
      join public.spaces s on s.id = rr.space_id
      ${where}
      order by rr.ran_at desc
      limit ${limit}
    `;
  });
}

// ---------------------------------------------------------------------------
// Enabling
// ---------------------------------------------------------------------------

/**
 * A rule cannot be enabled until it has been dry-run.
 *
 * The schema says so in a comment and leaves it to the application; this is the
 * application. It is the whole safety story of the phase: nobody turns on
 * something that rewrites their tasks without having read, in sentences, what
 * it is about to do.
 */
export async function setRuleEnabled(
  userId: string,
  ruleId: string,
  enabled: boolean,
): Promise<{ ok: true } | { error: string }> {
  const row = await getRule(userId, ruleId);
  if (!row) return { error: 'That rule does not exist, or is not yours to change.' };

  if (enabled) {
    const { rule, problems } = parseRuleRow(row);
    if (!rule) return { error: `This rule cannot be enabled: ${problems.join('; ')}` };
    if (!row.lastDryRunAt) {
      return { error: 'Dry-run this rule first. A rule is only enabled after somebody has read what it would do.' };
    }
  }

  await asUser(userId, async (tx) => {
    await tx`update public.rules set is_enabled = ${enabled} where id = ${ruleId}::uuid`;
  });
  return { ok: true };
}

/**
 * Every enabled rule in the caller's spaces whose trigger is this one.
 *
 * This is what a write path calls after it has changed something. Note the
 * absence of any "for user X" argument: the rules that fire are the rules the
 * acting user can see, which is the same thing RLS already decided.
 */
export async function firingRules(userId: string, kind: TriggerKind): Promise<RuleRow[]> {
  const rules = await listRules(userId);
  return rules.filter((r) => {
    if (!r.isEnabled) return false;
    const { rule } = parseRuleRow(r);
    return rule?.trigger.kind === kind;
  });
}

/**
 * Fire every enabled rule for one trigger against one task.
 *
 * Errors are swallowed on purpose and recorded on the run: a rule that throws
 * must not fail the write that triggered it. Somebody creating a task should
 * not lose it because an automation they wrote last month is malformed.
 */
export async function fireForTask(
  userId: string,
  kind: TriggerKind,
  taskId: string,
): Promise<{ fired: number; changes: number }> {
  let fired = 0;
  let changes = 0;
  for (const row of await firingRules(userId, kind)) {
    try {
      const result = await runRule(userId, row.id, { dryRun: false, taskId });
      if ('error' in result) continue;
      fired += 1;
      changes += result.applied + result.notified;
    } catch {
      // Recorded by runRule where it can be; never fatal to the caller's write.
    }
  }
  return { fired, changes };
}

// ---------------------------------------------------------------------------
// Writing rules
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return base || 'rule';
}

export async function createRule(
  userId: string,
  input: { spaceId: string; name: string; description: string; trigger: Trigger },
): Promise<{ id: string } | { error: string }> {
  const name = input.name.trim();
  if (!name) return { error: 'A rule needs a name.' };
  if (!input.spaceId) return { error: 'A rule belongs to one space; pick one.' };

  return asUser(userId, async (tx) => {
    // The slug is unique per space, so a second "Bins" in the same space gets a
    // suffix rather than an error somebody has to decode.
    const base = slugify(name);
    const [taken] = await tx<{ n: number }[]>`
      select count(*)::int as n from public.rules
      where space_id = ${input.spaceId}::uuid and slug like ${base + '%'}
    `;
    const slug = taken.n ? `${base}-${taken.n + 1}` : base;

    const [row] = await tx<{ id: string }[]>`
      insert into public.rules (space_id, owner_id, name, slug, description, trigger, conditions, actions, is_enabled)
      values (${input.spaceId}::uuid, ${userId}::uuid, ${name}, ${slug},
              ${input.description.trim()}, ${tx.json(input.trigger)},
              ${tx.json([])}, ${tx.json([])}, false)
      returning id
    `;
    return { id: row.id };
  });
}

/**
 * Change a rule's shape.
 *
 * **Any structural change disables the rule and clears its dry run.** A preview
 * describes the rule that was previewed; the moment a condition or an action
 * changes, the sentences somebody read no longer describe what will happen. The
 * cost is one extra click after an edit, and the alternative is a rule running
 * unattended on the strength of a preview of a different rule.
 */
export async function updateRuleParts(
  userId: string,
  ruleId: string,
  patch: {
    name?: string;
    description?: string;
    trigger?: Trigger;
    conditions?: Conditions;
    actions?: Action[];
  },
): Promise<{ ok: true } | { error: string }> {
  const row = await getRule(userId, ruleId);
  if (!row) return { error: 'That rule does not exist, or is not yours to change.' };

  const structural =
    patch.trigger !== undefined || patch.conditions !== undefined || patch.actions !== undefined;

  const name = patch.name?.trim();
  if (patch.name !== undefined && !name) return { error: 'A rule needs a name.' };

  await asUser(userId, async (tx) => {
    await tx`
      update public.rules set
        name        = ${name ?? row.name},
        description = ${patch.description?.trim() ?? row.description},
        trigger     = ${tx.json((patch.trigger ?? row.trigger) as never)},
        conditions  = ${tx.json((patch.conditions ?? row.conditions) as never)},
        actions     = ${tx.json((patch.actions ?? row.actions) as never)},
        is_enabled  = ${structural ? false : row.isEnabled},
        last_dry_run_at = ${structural ? null : row.lastDryRunAt}
      where id = ${ruleId}::uuid
    `;
  });
  return { ok: true };
}

/** Append a condition. Validated before it is stored, so a stored rule always parses. */
export async function addCondition(
  userId: string,
  ruleId: string,
  raw: unknown,
): Promise<{ ok: true } | { error: string }> {
  const row = await getRule(userId, ruleId);
  if (!row) return { error: 'That rule does not exist, or is not yours to change.' };
  let next: Conditions;
  try {
    next = [...parseConditions(row.conditions), ...parseConditions([raw])];
  } catch (err) {
    return { error: err instanceof RuleShapeError ? err.message : 'that condition is malformed' };
  }
  return updateRuleParts(userId, ruleId, { conditions: next });
}

export async function removeCondition(
  userId: string,
  ruleId: string,
  index: number,
): Promise<{ ok: true } | { error: string }> {
  const row = await getRule(userId, ruleId);
  if (!row) return { error: 'That rule does not exist, or is not yours to change.' };
  const current = Array.isArray(row.conditions) ? (row.conditions as unknown[]) : [];
  if (index < 0 || index >= current.length) return { error: 'There is no such condition.' };
  const next = current.filter((_, i) => i !== index);
  return updateRuleParts(userId, ruleId, { conditions: parseConditions(next) });
}

export async function addAction(
  userId: string,
  ruleId: string,
  raw: unknown,
): Promise<{ ok: true } | { error: string }> {
  const row = await getRule(userId, ruleId);
  if (!row) return { error: 'That rule does not exist, or is not yours to change.' };
  let next: Action[];
  try {
    next = [...parseActions(row.actions), ...parseActions([raw])];
  } catch (err) {
    return { error: err instanceof RuleShapeError ? err.message : 'that action is malformed' };
  }
  return updateRuleParts(userId, ruleId, { actions: next });
}

export async function removeAction(
  userId: string,
  ruleId: string,
  index: number,
): Promise<{ ok: true } | { error: string }> {
  const row = await getRule(userId, ruleId);
  if (!row) return { error: 'That rule does not exist, or is not yours to change.' };
  const current = Array.isArray(row.actions) ? (row.actions as unknown[]) : [];
  if (index < 0 || index >= current.length) return { error: 'There is no such action.' };
  const next = current.filter((_, i) => i !== index);
  return updateRuleParts(userId, ruleId, { actions: parseActions(next) });
}

export async function deleteRule(userId: string, ruleId: string): Promise<void> {
  await asUser(userId, async (tx) => {
    await tx`delete from public.rules where id = ${ruleId}::uuid`;
  });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export type DeliveryRow = {
  id: string;
  channel: string;
  status: string;
  provider: string;
  error: string | null;
  attempts: number;
  sentAt: string | null;
  createdAt: string;
  space: SpaceRef;
};

/**
 * What the notify action actually did.
 *
 * A delivery that went nowhere visible is a half feature: the row exists in the
 * database and nobody who used the app would know whether their rule had sent
 * anything. This is the surface that answers that, and it says which provider
 * answered — so "it sent a notification" never quietly means "the in-memory
 * outbox accepted one".
 */
export async function listDeliveries(userId: string, limit = 8): Promise<DeliveryRow[]> {
  return asUser(userId, async (tx) => {
    return tx<DeliveryRow[]>`
      select
        d.id, d.channel, d.status, d.provider, d.error, d.attempts,
        d.sent_at    as "sentAt",
        d.created_at as "createdAt",
        jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                           'colour', s.colour, 'icon', s.icon) as space
      from public.notification_deliveries d
      join public.spaces s on s.id = d.space_id
      order by d.created_at desc
      limit ${limit}
    `;
  });
}
