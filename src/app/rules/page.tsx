import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listSpaces } from '@/lib/queries/spaces';
import { listRuleRuns, listRules, parseRuleRow } from '@/lib/queries/rules';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { ComposeRule } from '@/components/ComposeRule';
import { RunSummaryLine } from '@/components/RuleParts';
import { describeRule, TRIGGER_LABEL, isTriggerKind } from '@/lib/rules';
import { formatRelative, plural } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * The rules list.
 *
 * Every row says three things before you open it: which space the rule can
 * touch, what it would do in one sentence, and whether it is on. A rule you
 * cannot read at a glance is a rule you will not audit.
 */
export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const user = await requireUser();
  const [spaces, rules, runs] = await Promise.all([
    listSpaces(user.id),
    listRules(user.id),
    listRuleRuns(user.id, { limit: 8 }),
  ]);

  const writable = spaces.filter((s) => s.canWrite);
  const enabled = rules.filter((r) => r.isEnabled).length;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="hairline border-b px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-[15px] font-semibold">Rules</h1>
          <span className="faint text-[12px]">{plural(rules.length, 'rule')}</span>
          <span className="faint text-[12px]">
            {enabled} on, {rules.length - enabled} off
          </span>
        </div>
        <p className="muted mt-0.5 text-[12px]">
          A rule watches for something, checks some conditions, and does
          something. It only ever touches its own space, it never reads a locked
          item, and it cannot be switched on until you have dry-run it and read
          what it would do.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="hairline border-b px-5 py-2 text-[12px]"
          style={{ background: 'var(--c-amber-bg)', color: 'var(--c-amber)' }}
        >
          {error}
        </p>
      )}

      <ComposeRule spaces={writable} />

      <ul className="flex flex-col">
        {rules.map((row) => {
          const { rule, problems } = parseRuleRow(row);
          const triggerKind =
            rule?.trigger.kind ??
            (isTriggerKind((row.trigger as { kind?: string })?.kind) ? (row.trigger as { kind: string }).kind : null);
          return (
            <li key={row.id} className="hairline border-b">
              <Link
                href={`/rules/${row.id}`}
                className="row-hover flex flex-col gap-1 px-5 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <SpaceIndicator space={row.space} />
                  <span className="text-[13px] font-medium">{row.name}</span>
                  <EnabledChip enabled={row.isEnabled} />
                  {problems.length > 0 && (
                    <span
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]"
                      style={{ background: 'var(--c-rose-bg)', color: 'var(--c-rose)' }}
                    >
                      <Icon name="alert" size={11} />
                      will not parse
                    </span>
                  )}
                </div>

                <p className="muted text-[12px]">
                  {rule ? describeRule(rule) : problems.join('; ')}
                </p>

                <p className="faint flex flex-wrap gap-x-3 text-[11px]">
                  <span>
                    {triggerKind && isTriggerKind(triggerKind)
                      ? TRIGGER_LABEL[triggerKind]
                      : 'Trigger unknown'}
                  </span>
                  <span>
                    {row.lastDryRunAt
                      ? `Dry-run ${formatRelative(row.lastDryRunAt)}`
                      : 'Never dry-run'}
                  </span>
                  <span>
                    {row.runCount > 0
                      ? `Run ${plural(row.runCount, 'time')}, last ${formatRelative(row.lastRunAt!)}`
                      : 'Never run for real'}
                  </span>
                </p>
              </Link>
            </li>
          );
        })}

        {rules.length === 0 && (
          <li className="muted px-5 py-8 text-[13px]">
            No rules yet. Adding one above creates it switched off — nothing runs
            until you have previewed it.
          </li>
        )}
      </ul>

      <section className="px-5 py-4">
        <h2 className="text-[13px] font-semibold">Recent runs</h2>
        <p className="muted mt-0.5 text-[12px]">
          Every run is recorded, dry ones included — what you were shown before
          you switched something on is the thing worth keeping.
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {runs.map((run) => (
            <li key={run.id} className="hairline flex flex-wrap items-center gap-2 rounded border px-2 py-1.5">
              <SpaceIndicator space={run.space} />
              <Link href={`/rules/${run.ruleId}`} className="text-[12px] font-medium underline-offset-2 hover:underline">
                {run.ruleName}
              </Link>
              <RunSummaryLine run={run} />
            </li>
          ))}
          {runs.length === 0 && (
            <li className="faint text-[12px]">Nothing has run yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}

function EnabledChip({ enabled }: { enabled: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]"
      style={
        enabled
          ? { background: 'var(--bg-sunken)', color: 'var(--text)', border: '1px solid var(--line-strong)' }
          : { background: 'var(--bg-sunken)', color: 'var(--text-faint)' }
      }
    >
      <Icon name={enabled ? 'check' : 'pause'} size={11} />
      {enabled ? 'On' : 'Off'}
    </span>
  );
}
