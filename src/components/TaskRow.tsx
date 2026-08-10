import Link from 'next/link';
import { Icon } from './Icon';
import { SpaceIndicator, CategoryChip } from './SpaceIndicator';
import { toggleTaskDone } from '@/app/actions';
import { formatDueDate, daysFromToday, formatDuration } from '@/lib/format';
import { AssigneePicker } from './AssigneePicker';
import type { AssigneeOption, TaskRow as Task } from '@/lib/queries/tasks';

/**
 * One task, one line. Dense by design: the eye should be able to run down a
 * column of these and find the one it wants without reading every word.
 *
 * The space indicator is never optional here — see SpaceIndicator.tsx.
 */
export function TaskRow({
  task,
  showAssignee = true,
  assignable,
}: {
  task: Task;
  showAssignee?: boolean;
  /**
   * Who this task can be given to. Absent means the row is read-only about
   * assignment and falls back to the name it always showed — which is what
   * `/tasks/mine` wants, and what a locked row must have.
   */
  assignable?: AssigneeOption[];
}) {
  const done = task.status === 'done';
  const overdue = !done && task.dueOn != null && daysFromToday(task.dueOn) < 0;

  return (
    // 56px on a phone, and the old density from `sm` up. Desktop is untouched:
    // that list is read a hundred rows at a time with a mouse, and 56px rows
    // would turn a screenful into a third of one.
    <li className="hairline row-hover group flex min-h-14 items-center gap-3.5 border-b px-5 py-2.5 sm:min-h-0 sm:items-baseline sm:gap-2.5 sm:px-3 sm:py-1.5">
      <form action={toggleTaskDone} className="flex shrink-0 self-center">
        <input type="hidden" name="taskId" value={task.id} />
        <input type="hidden" name="done" value={String(!done)} />
        <button
          type="submit"
          aria-label={done ? `Mark “${task.title}” as not done` : `Mark “${task.title}” as done`}
          // 22px is the thumb-sized version of the same box; `sm` puts it back
          // to 16px, where it is being hit with a pointer.
          className="flex h-[22px] w-[22px] items-center justify-center rounded-md border sm:h-4 sm:w-4 sm:rounded-[4px]"
          style={{
            borderColor: done ? 'var(--accent)' : 'var(--line-strong)',
            background: done ? 'var(--accent)' : 'transparent',
            color: 'var(--accent-text)',
          }}
        >
          {done && <Icon name="check" size={12} strokeWidth={3} />}
        </button>
      </form>

      {/* Two lines on a phone, one on a desktop. The split matters: when this
          was a single row with a `shrink-0` block of metadata on the right, the
          metadata won and the title — the only part worth reading — was pushed
          off a 390px screen entirely. Whatever else wraps, the title does not
          move. */}
      <div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-2.5">
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
                style={
                  done ? { color: 'var(--text-faint)', textDecoration: 'line-through' } : undefined
                }
              >
                {task.title}
              </Link>
            )}

            {task.priority === 'urgent' && (
              <span
                className="shrink-0 text-2xs font-semibold uppercase"
                style={{ color: 'var(--danger)' }}
              >
                Urgent
              </span>
            )}
            {task.visibility === 'private' && (
              <span
                className="faint flex shrink-0 items-center gap-0.5 text-2xs"
                title="Private to you"
              >
                <Icon name="eye_off" size={10} />
                Private
              </span>
            )}
          </div>

          {(task.waitingOn || task.checklistTotal > 0 || task.noteCount > 0) && (
            <div className="faint mt-0.5 flex items-center gap-3 text-xs sm:text-2xs">
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

        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs sm:mt-0 sm:shrink-0 sm:flex-nowrap sm:justify-end sm:text-2xs">
          {/* Edge 32. A picker when the page supplied the options and the row is
              writable; otherwise the name as before. A locked task is excluded
              because `setTaskAssignee` refuses one — offering a control that
              silently does nothing is worse than not offering it.

              The picker is a pointer control and it is `sm` and up only: a
              select wide enough to hold "Priya Raghavan" is a third of a 390px
              row, and it pushed everything else onto a second line. A phone
              gets the name, and the task's own page is where it is changed. */}
          {showAssignee &&
            (assignable && assignable.length > 0 && !task.isLocked ? (
              <>
                <span className="hidden sm:contents">
                  <AssigneePicker
                    taskId={task.id}
                    assigneeId={task.assigneeId}
                    options={assignable}
                    label={task.title}
                  />
                </span>
                {task.assigneeName && (
                  <span className="sm:hidden">
                    <Assignee name={task.assigneeName} isMine={task.isMine} />
                  </span>
                )}
              </>
            ) : (
              task.assigneeName && <Assignee name={task.assigneeName} isMine={task.isMine} />
            ))}
          {task.estimateMinutes != null && (
            <span className="faint hidden text-2xs sm:inline">
              {formatDuration(task.estimateMinutes)}
            </span>
          )}
          <CategoryChip category={task.category} />
          {/* The due date is right-aligned against the row on a phone — see the
              sibling below — so here it is `sm` and up only. */}
          {task.dueOn && (
            <span
              className="hidden text-2xs tabular-nums sm:inline"
              style={{ color: overdue ? 'var(--danger)' : 'var(--text-muted)' }}
            >
              {formatDueDate(task.dueOn)}
            </span>
          )}
          <SpaceIndicator space={task.space} />
        </div>
      </div>

      {/* Hard right, vertically centred, on a phone only. A column of dates is
          read down its right edge; inside the wrapping metadata cluster it
          landed in a different place on every row. */}
      {task.dueOn && (
        <span
          className="shrink-0 self-center text-sm tabular-nums sm:hidden"
          style={{ color: overdue ? 'var(--danger)' : 'var(--text-muted)' }}
        >
          {formatDueDate(task.dueOn)}
        </span>
      )}
    </li>
  );
}

/**
 * Who the task is for.
 *
 * `assignee_id` has been on the table since migration 0002 and `listTasks` has
 * selected it on every row since Phase 0, but nothing ever rendered it — so in
 * a shared household the row could not answer the question the household
 * actually asks, which is whose job this is.
 *
 * Somebody else's name is the signal and is set at `--text-muted`; your own is
 * "You" and is set at `--text-faint`. That way round because in your own lists
 * nearly every row is yours, and what the eye is hunting for is the two that
 * are not. On `/tasks/mine` it is not rendered at all — a column that says
 * "You" on every row of a list called Mine is a column saying nothing.
 *
 * No colour and no avatar: this sits beside a category chip and a space chip,
 * and a third coloured thing on one row is a colour chart. The icon plus the
 * name is the whole treatment.
 */
function Assignee({ name, isMine }: { name: string; isMine: boolean }) {
  const first = name.split(' ')[0];
  return (
    <span
      className={`chip chip-plain shrink-0 ${isMine ? 'faint' : 'muted'}`}
      title={`Assigned to ${name}`}
    >
      <Icon name="user" size={11} strokeWidth={2} />
      {isMine ? 'You' : first}
    </span>
  );
}
