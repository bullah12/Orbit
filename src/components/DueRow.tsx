'use client';

import { useOptimistic, useTransition } from 'react';
import Link from 'next/link';
import { Icon } from './Icon';
import { toggleTaskDone } from '@/app/actions';
import type { SummaryDue } from '@/lib/queries/summary';

/**
 * One due item on Now, with an optimistic checkbox.
 *
 * The checkbox flips immediately and the row takes `.pending` until the write
 * comes back. A dotted underline is the right tell for this: it survives
 * greyscale, it needs no colour to mean "not settled yet", and unlike a spinner
 * or a badge it does not change the row's height or width — so a list of thirty
 * of these does not reflow when one of them is acknowledged.
 */
export function DueRow({ item }: { item: SummaryDue }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useOptimistic(item.done);

  function toggle() {
    startTransition(async () => {
      setDone(!done);
      const data = new FormData();
      data.set('taskId', item.id);
      data.set('done', String(!done));
      await toggleTaskDone(data);
    });
  }

  const label = done ? `Mark “${item.title}” as not done` : `Mark “${item.title}” as done`;

  return (
    <li className="row row-hover">
      <button
        type="button"
        onClick={toggle}
        aria-label={item.locked ? 'Locked task' : label}
        aria-pressed={done}
        disabled={item.locked}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border"
        style={{
          borderColor: done ? 'var(--accent)' : 'var(--line-strong)',
          background: done ? 'var(--accent)' : 'transparent',
          color: 'var(--accent-text)',
        }}
      >
        {done && <Icon name="check" size={10} strokeWidth={3} />}
      </button>

      {item.locked ? (
        // The absence is the design, not a failure. Mono and dashed say so.
        <span className="locked min-w-0 flex-1 truncate">Locked — opens on this device only</span>
      ) : (
        <Link
          href={`/tasks/item/${item.id}` as never}
          className={`min-w-0 flex-1 truncate${pending ? ' pending' : ''}`}
          style={done && !pending ? { color: 'var(--text-faint)', textDecoration: 'line-through' } : undefined}
        >
          {item.title}
        </Link>
      )}

      {/* Ordinal, so it stays text. Colour already means which person. */}
      {item.state === 'overdue' && (
        <span className="shrink-0 text-2xs font-semibold uppercase" style={{ color: 'var(--danger)' }}>
          Overdue
        </span>
      )}

      <span
        className="chip chip-plain shrink-0"
        style={{ color: `var(--c-${item.categoryColour}, var(--c-slate))` }}
      >
        {item.categoryName}
      </span>
    </li>
  );
}
