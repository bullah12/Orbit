import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { getRule, listRuleRuns, parseRuleRow } from '@/lib/queries/rules';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { RunDetail, RunKindChip, RunSummaryLine } from '@/components/RuleParts';
import { RuleActionForm } from '@/components/RuleActionForm';
import {
  CONDITION_FIELDS,
  CONDITION_OPS,
  TRIGGER_KINDS,
  TRIGGER_LABEL,
  describeAction,
  describeCondition,
  describeRule,
} from '@/lib/rules';
import { formatRelative, plural } from '@/lib/format';
import {
  addRuleConditionAction,
  deleteRuleAction,
  dryRunRuleAction,
  editRuleConditionAction,
  removeRuleActionAction,
  removeRuleConditionAction,
  runRuleNowAction,
  setRuleEnabledAction,
  updateRuleAction,
} from '@/app/actions';

export const dynamic = 'force-dynamic';

/**
 * One rule.
 *
 * The page is arranged in the order somebody actually works: read what it
 * does, change it, preview it, then — and only then — switch it on. The
 * enable control is deliberately below the preview and refuses until a dry run
 * exists, because the whole safety story of this phase is that nothing runs
 * unattended on your tasks until you have read a sentence saying what it will
 * do to each one.
 */
export default async function RulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; preview?: string; ran?: string; created?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, preview, ran, created, saved } = await searchParams;
  const user = await requireUser();

  const row = await getRule(user.id, id);
  if (!row) notFound();

  const { rule, problems } = parseRuleRow(row);
  const runs = await listRuleRuns(user.id, { ruleId: id, limit: 12 });
  const latest = runs[0] ?? null;
  const conditions = rule?.conditions ?? [];
  const actions = rule?.actions ?? [];
  const canEnable = Boolean(rule) && Boolean(row.lastDryRunAt) && actions.length > 0;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="hairline border-b px-5 py-4">
        <p className="faint text-2xs">
          <Link href="/rules" className="underline-offset-2 hover:underline">
            Rules
          </Link>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <SpaceIndicator space={row.space} size="md" />
          <h1 className="text-lg font-semibold">{row.name}</h1>
          <span
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs"
            style={
              row.isEnabled
                ? { background: 'var(--bg-sunken)', color: 'var(--text)', border: '1px solid var(--line-strong)' }
                : { background: 'var(--bg-sunken)', color: 'var(--text-faint)' }
            }
          >
            <Icon name={row.isEnabled ? 'check' : 'pause'} size={11} />
            {row.isEnabled ? 'On' : 'Off'}
          </span>
        </div>
        <p className="muted mt-1 text-xs">
          {rule ? describeRule(rule) : problems.join('; ')}
        </p>
        <p className="faint mt-0.5 text-2xs">
          This rule can only see and change things in {row.space.name}.
        </p>
      </header>

      {/*
        One live region for everything the page has to say back. Enabling,
        previewing and every edit land here, so a screen reader hears the
        outcome without hunting for where it appeared.
      */}
      <div aria-live="polite" className="empty:hidden">
        {error && (
          <p
            role="alert"
            className="hairline border-b px-5 py-2 text-xs"
            style={{ background: 'var(--c-amber-bg)', color: 'var(--c-amber)' }}
          >
            {error}
          </p>
        )}
        {!error && (created || saved || preview || ran) && (
          <p className="hairline muted border-b px-5 py-2 text-xs">
            {created && 'Rule created, switched off. Give it conditions and actions, then preview it.'}
            {saved && 'Saved. Changing a rule switches it off and clears its preview — the sentences you read described the old one.'}
            {preview && 'Dry run finished. Nothing was changed; the preview below is what would happen.'}
            {ran && 'Run finished. The changes below were applied.'}
          </p>
        )}
      </div>

      <div className="grid gap-5 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex flex-col gap-5">
          {/* ---------------------------------------------------------- */}
          <section className="surface rounded p-3">
            <h2 className="text-sm font-semibold">What it watches for</h2>
            <form action={updateRuleAction} className="mt-2 flex flex-col gap-2">
              <input type="hidden" name="ruleId" value={row.id} />

              <label className="flex flex-col gap-1">
                <span className="faint text-2xs">Name</span>
                <input name="name" defaultValue={row.name} required className="input text-sm" />
              </label>

              <label className="flex flex-col gap-1">
                <span className="faint text-2xs">What it is for</span>
                <input
                  name="description"
                  defaultValue={row.description}
                  className="input text-xs"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="faint text-2xs">Trigger</span>
                <select
                  name="triggerKind"
                  defaultValue={rule?.trigger.kind ?? 'task.created'}
                  className="input text-xs"
                >
                  {TRIGGER_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {TRIGGER_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="faint text-2xs">
                  Schedule, as cron — used only when the trigger is a schedule
                </span>
                <input
                  name="cron"
                  defaultValue={rule?.trigger.kind === 'schedule' ? rule.trigger.cron : '0 7 * * *'}
                  className="input font-mono text-xs"
                />
              </label>

              <button type="submit" className="hairline self-start rounded border px-2 py-1 text-xs">
                Save
              </button>
            </form>
          </section>

          {/* ---------------------------------------------------------- */}
          <section className="surface rounded p-3">
            <h2 className="text-sm font-semibold">Conditions</h2>
            <p className="muted mt-0.5 text-xs">
              All of them have to be true. There is no “or” — two rules are
              clearer than one rule with a branch in it.
            </p>

            <ul className="mt-2 flex flex-col gap-1" id="rule-conditions">
              {/* Edited where it sits, keeping its position. Order is not
                  evaluation order — every condition has to hold — but it is
                  reading order, and a rule you have to re-read from the bottom
                  every time you change a threshold is a rule nobody edits. */}
              {conditions.map((c, i) => (
                <li key={i} className="hairline flex flex-col gap-1 rounded border px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-xs">{describeCondition(c)}</span>
                    <form action={removeRuleConditionAction}>
                      <input type="hidden" name="ruleId" value={row.id} />
                      <input type="hidden" name="index" value={i} />
                      <button
                        type="submit"
                        className="faint rounded p-1"
                        aria-label={`Remove condition: ${describeCondition(c)}`}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    </form>
                  </div>
                  <form
                    action={editRuleConditionAction}
                    className="flex flex-wrap items-center gap-1.5"
                    aria-label={`Change condition ${i + 1}`}
                  >
                    <input type="hidden" name="ruleId" value={row.id} />
                    <input type="hidden" name="index" value={i} />
                    <select
                      name="field"
                      defaultValue={c.field}
                      aria-label={`Condition ${i + 1}: field`}
                      className="input text-2xs"
                    >
                      {Object.entries(CONDITION_FIELDS).map(([key, meta]) => (
                        <option key={key} value={key}>{meta.label}</option>
                      ))}
                    </select>
                    <select
                      name="op"
                      defaultValue={c.op}
                      aria-label={`Condition ${i + 1}: operator`}
                      className="input text-2xs"
                    >
                      {Object.entries(CONDITION_OPS).map(([key, meta]) => (
                        <option key={key} value={key}>{meta.label}</option>
                      ))}
                    </select>
                    <input
                      name="value"
                      defaultValue={c.value == null ? '' : String(c.value)}
                      aria-label={`Condition ${i + 1}: value`}
                      autoComplete="off"
                      className="input text-2xs"
                    />
                    <button type="submit" className="hairline rounded border px-2 py-0.5 text-2xs">
                      Save this condition
                    </button>
                  </form>
                </li>
              ))}
              {conditions.length === 0 && (
                <li className="faint text-xs">
                  No conditions — this rule matches every open task in its space.
                </li>
              )}
            </ul>

            <form
              action={addRuleConditionAction}
              id="add-condition"
              className="mt-2 flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="ruleId" value={row.id} />
              <label className="flex flex-col gap-1">
                <span className="faint text-2xs">Field</span>
                <select name="field" className="input text-xs">
                  {Object.entries(CONDITION_FIELDS).map(([key, meta]) => (
                    <option key={key} value={key}>
                      {meta.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="faint text-2xs">Is</span>
                <select name="op" className="input text-xs">
                  {Object.entries(CONDITION_OPS).map(([key, meta]) => (
                    <option key={key} value={key}>
                      {meta.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="faint text-2xs">Value</span>
                <input name="value" className="input text-xs" autoComplete="off" />
              </label>
              <button type="submit" className="hairline rounded border px-2 py-1 text-xs">
                Add condition
              </button>
            </form>
          </section>

          {/* ---------------------------------------------------------- */}
          <section className="surface rounded p-3">
            <h2 className="text-sm font-semibold">Actions</h2>
            <p className="muted mt-0.5 text-xs">
              What it does to each task that matches. An action that would change
              nothing is not performed and does not appear in the audit trail.
            </p>

            <ul className="mt-2 flex flex-col gap-1" id="rule-actions">
              {/* Edited where it sits, on the same terms as a condition — except
                  that order here *is* evaluation order, so re-adding an action at
                  the end to change it could change what the rule does. */}
              {actions.map((a, i) => (
                <li key={i} className="hairline flex flex-col gap-1 rounded border px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-xs">{describeAction(a)}</span>
                    <form action={removeRuleActionAction}>
                      <input type="hidden" name="ruleId" value={row.id} />
                      <input type="hidden" name="index" value={i} />
                      <button
                        type="submit"
                        className="faint rounded p-1"
                        aria-label={`Remove action: ${describeAction(a)}`}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    </form>
                  </div>
                  <RuleActionForm mode="edit" ruleId={row.id} index={i} action={a} />
                </li>
              ))}
              {actions.length === 0 && (
                <li className="faint text-xs">
                  No actions — this rule cannot be switched on until it has one.
                </li>
              )}
            </ul>

            <div className="mt-2">
              <RuleActionForm mode="add" ruleId={row.id} />
            </div>
          </section>

          {/* ---------------------------------------------------------- */}
          <section className="surface rounded p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">
                {latest ? (latest.isDryRun ? 'Preview' : 'Last run') : 'Preview'}
              </h2>
              {latest && <RunSummaryLine run={latest} />}
            </div>

            <div className="mt-2">
              {latest ? (
                <RunDetail run={latest} />
              ) : (
                <p className="muted text-xs">
                  Nothing has run yet. Dry-run it to see, task by task, exactly
                  what it would do.
                </p>
              )}
            </div>
          </section>
        </div>

        {/* ------------------------------------------------------------ */}
        <aside className="flex flex-col gap-5">
          <section className="surface rounded p-3">
            <h2 className="text-sm font-semibold">Run it</h2>

            <form action={dryRunRuleAction} className="mt-2">
              <input type="hidden" name="ruleId" value={row.id} />
              <button
                type="submit"
                className="w-full rounded px-2 py-1.5 text-xs font-medium btn-primary"
              >
                Dry run — change nothing
              </button>
            </form>
            <p className="faint mt-1 text-2xs">
              Evaluates every open task in {row.space.name} and writes down what
              it would do. Locked tasks are listed as skipped, never read.
            </p>

            <div className="hairline my-3 border-t" />

            <form action={setRuleEnabledAction}>
              <input type="hidden" name="ruleId" value={row.id} />
              <input type="hidden" name="enabled" value={row.isEnabled ? '0' : '1'} />
              <button
                type="submit"
                disabled={!row.isEnabled && !canEnable}
                className="hairline w-full rounded border px-2 py-1.5 text-xs disabled:opacity-45"
              >
                {row.isEnabled ? 'Switch off' : 'Switch on'}
              </button>
            </form>
            <p className="faint mt-1 text-2xs">
              {row.isEnabled
                ? 'It runs by itself when its trigger happens.'
                : !rule
                  ? 'This rule will not parse, so it cannot be switched on.'
                  : actions.length === 0
                    ? 'Add an action first — a rule with none would do nothing.'
                    : !row.lastDryRunAt
                      ? 'Dry-run it first. Nothing runs unattended on your tasks until you have read what it would do.'
                      : `Previewed ${formatRelative(row.lastDryRunAt)}. Ready to switch on.`}
            </p>

            {row.isEnabled && (
              <>
                <div className="hairline my-3 border-t" />
                <form action={runRuleNowAction}>
                  <input type="hidden" name="ruleId" value={row.id} />
                  <button type="submit" className="hairline w-full rounded border px-2 py-1.5 text-xs">
                    Run now, for real
                  </button>
                </form>
                <p className="faint mt-1 text-2xs">
                  Applies the changes. Recorded in the audit trail below.
                </p>
              </>
            )}
          </section>

          <section className="surface rounded p-3">
            <h2 className="text-sm font-semibold">Audit trail</h2>
            <p className="muted mt-0.5 text-xs">
              {plural(runs.length, 'run')} recorded, dry ones included.
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {runs.map((run) => (
                <li key={run.id} className="hairline rounded border px-2 py-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <RunKindChip isDryRun={run.isDryRun} />
                    <span className="faint text-2xs">{formatRelative(run.ranAt)}</span>
                    <span className="faint text-2xs">
                      {run.effects.length} considered ·{' '}
                      {run.effects.reduce((n, e) => n + e.changes.length, 0)} changed
                    </span>
                    {run.durationMs !== null && (
                      <span className="faint text-2xs">{run.durationMs} ms</span>
                    )}
                  </div>
                  {run.error && (
                    <p className="mt-0.5 text-2xs" style={{ color: 'var(--c-rose)' }}>
                      {run.error}
                    </p>
                  )}
                </li>
              ))}
              {runs.length === 0 && <li className="faint text-xs">Nothing yet.</li>}
            </ul>
          </section>

          <section className="surface rounded p-3">
            <h2 className="text-sm font-semibold">Delete</h2>
            <p className="muted mt-0.5 text-xs">
              Deleting a rule deletes its runs with it. Switching it off keeps
              both.
            </p>
            <form action={deleteRuleAction} className="mt-2">
              <input type="hidden" name="ruleId" value={row.id} />
              <button
                type="submit"
                className="hairline w-full rounded border px-2 py-1.5 text-xs"
                style={{ color: 'var(--danger)' }}
              >
                Delete this rule
              </button>
            </form>
          </section>
        </aside>
      </div>
    </div>
  );
}
