import Link from 'next/link';
import { Icon } from './Icon';
import { SpaceIndicator, CategoryChip } from './SpaceIndicator';
import { toggleTaskDone } from '@/app/actions';
import { formatDueDate, daysFromToday, formatDuration } from '@/lib/format';
import type { TaskRow as Task } from '@/lib/queries/tasks';

/**
 * One task, one line. Dense by design: the eye should be able to run down a
 * column of these and find the one it wants without reading every word.
 *
 * The space indicator is never optional here — see SpaceIndicator.tsx.
 */
export function TaskRow({ task }: { task: Task }) {
  const done = task.status === 'done';
  const overdue = !done && task.dueOn != null && daysFromToday(task.dueOn) < 0;

  return (
    <li className="hairline row-hover group flex items-baseline gap-2.5 border-b px-3 py-1.5">
      <form action={toggleTaskDone} className="flex shrink-0 self-center">
        <input type="hidden" name="taskId" value={task.id} />
        <input type="hidden" name="done" value={String(!done)} />
        <button
          type="submit"
          aria-label={done ? `Mark “${task.title}” as not done` : `Mark “${task.title}” as done`}
          className="flex h-4 w-4 items-center justify-center rounded-[4px] border"
          style={{
            borderColor: done ? 'var(--accent)' : 'var(--line-strong)',
            background: done ? 'var(--accent)' : 'transparent',
            color: 'var(--accent-text)',
          }}
        >
          {done && <Icon name="check" size={10} strokeWidth={3} />}
        </button>
      </form>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {task.isLocked ? (
            <span className="muted flex items-center gap-1.5 italic">
              <Icon name="lock" size={12} />
              Locked — opens on this device only
            </span>
          ) : (
            <Link
              href={`/tasks/item/${task.id}` as never}
              className="truncate"
              style={done ? { color: 'var(--text-faint)', textDecoration: 'line-through' } : undefined}
            >
              {task.title}
            </Link>
          )}

          {task.priority === 'urgent' && (
            <span className="shrink-0 text-2xs font-semibold uppercase" style={{ color: 'var(--danger)' }}>
              Urgent
            </span>
          )}
          {task.visibility === 'private' && (
            <span className="faint flex shrink-0 items-center gap-0.5 text-2xs" title="Private to you">
              <Icon name="eye_off" size={10} />
              Private
            </span>
          )}
        </div>

        {(task.waitingOn || task.checklistTotal > 0 || task.noteCount > 0) && (
          <div className="faint mt-0.5 flex items-center gap-3 text-2xs">
            {task.waitingOn && <span>Waiting on {task.waitingOn}</span>}
            {task.checklistTotal > 0 && (
              <span>
                {task.checklistDone}/{task.checklistTotal} steps
              </span>
            )}
            {task.noteCount > 0 && (
              <span className="flex items-center gap-1">
                <Icon name="note" size={10} />
                {task.noteCount}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        {task.estimateMinutes != null && (
          <span className="faint hidden text-2xs sm:inline">
            {formatDuration(task.estimateMinutes)}
          </span>
        )}
        <CategoryChip category={task.category} />
        {task.dueOn && (
          <span
            className="text-2xs tabular-nums"
            style={{ color: overdue ? 'var(--danger)' : 'var(--text-muted)' }}
          >
            {formatDueDate(task.dueOn)}
          </span>
        )}
        <SpaceIndicator space={task.space} />
      </div>
    </li>
  );
}
