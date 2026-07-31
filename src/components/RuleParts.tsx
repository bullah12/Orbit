import { Icon } from './Icon';
import { formatRelative } from '@/lib/format';
import type { RuleRunRow } from '@/lib/queries/rules';

/**
 * The pieces of a run that both the rules list and a rule's own page render.
 *
 * A run is shown as a sentence and then, if you want it, as the list of every
 * item it looked at — including the ones it did not act on. "Why did it not
 * fire on that one" is the question this exists to answer.
 */

export function RunSummaryLine({ run }: { run: RuleRunRow }) {
  const changes = run.effects.reduce((n, e) => n + e.changes.length, 0);
  const matched = run.effects.filter((e) => e.matched).length;
  const skipped = run.effects.filter((e) => e.skipped).length;

  return (
    <span className="faint flex flex-wrap items-center gap-x-2 text-2xs">
      <RunKindChip isDryRun={run.isDryRun} />
      <span>{formatRelative(run.ranAt)}</span>
      <span>
        {run.effects.length} considered, {matched} matched, {changes}{' '}
        {changes === 1 ? 'change' : 'changes'}
        {skipped > 0 ? `, ${skipped} skipped` : ''}
      </span>
      {run.error && (
        <span style={{ color: 'var(--c-rose)' }} className="inline-flex items-center gap-1">
          <Icon name="alert" size={11} />
          {run.error}
        </span>
      )}
    </span>
  );
}

export function RunKindChip({ isDryRun }: { isDryRun: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-medium"
      style={
        isDryRun
          ? { background: 'var(--bg-sunken)', color: 'var(--text-muted)' }
          : { background: 'var(--bg-sunken)', color: 'var(--text)', border: '1px solid var(--line-strong)' }
      }
    >
      <Icon name={isDryRun ? 'eye_off' : 'check'} size={10} />
      {isDryRun ? 'Dry run' : 'Applied'}
    </span>
  );
}

/**
 * Every item a run considered.
 *
 * A skipped item states its reason rather than disappearing — a locked task
 * that a rule declined to read is a thing worth seeing on the page, because the
 * alternative reads as though the rule simply missed it.
 */
export function RunDetail({ run }: { run: RuleRunRow }) {
  if (run.effects.length === 0) {
    return (
      <p className="muted text-xs">
        Nothing to consider — this rule had no item it could apply to.
      </p>
    );
  }

  // The one task a rule changes must not be the thirty-first row. Everything
  // that happened comes first; the tasks the rule looked at and left alone are
  // still here — that is the "why did it not fire on that one" case — but they
  // are behind a disclosure rather than in front of the answer.
  const notable = run.effects.filter((e) => e.changes.length > 0 || e.skipped);
  const quiet = run.effects.filter((e) => !e.changes.length && !e.skipped);

  return (
    <div className="flex flex-col gap-2">
      {notable.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {notable.map((item) => (
            <Item key={item.entity} item={item} />
          ))}
        </ul>
      ) : (
        <p className="muted text-xs">
          Nothing would change — every task this rule looked at is already the
          way it wants it.
        </p>
      )}

      {quiet.length > 0 && (
        <details className="text-xs">
          <summary className="faint cursor-pointer">
            {quiet.length} {quiet.length === 1 ? 'task was' : 'tasks were'} looked
            at and left alone
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {quiet.map((item) => (
              <Item key={item.entity} item={item} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Item({ item }: { item: RuleRunRow['effects'][number] }) {
  return (
    <li
      className="hairline rounded border px-2 py-1.5"
      style={item.skipped ? { background: 'var(--bg-sunken)' } : undefined}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span style={{ color: item.matched ? 'var(--text)' : 'var(--text-faint)' }}>
          <Icon name={item.skipped ? 'lock' : item.matched ? 'arrow_right' : 'x'} size={11} />
        </span>
        <span className="text-xs font-medium">{item.title}</span>
        <span className="faint text-2xs">{item.reason}</span>
      </div>
      {item.changes.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5 pl-4">
          {item.changes.map((change, i) => (
            <li key={i} className="text-xs">
              {change.description}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
