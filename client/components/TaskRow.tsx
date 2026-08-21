import { Check, LockKeyhole } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatShortDate } from '../lib/date';
import type { Space, Task } from '../data/types';
import { useToggleTask } from '../data/hooks';
import s from '../styles/ui.module.css';

export function TaskRow({ task, spaces, compact = false }: { task: Task; spaces?: Space[] | undefined; compact?: boolean }) {
  const toggle = useToggleTask();
  const space = spaces?.find((item) => item.id === task.space_id);
  return (
    <li className={`${s.taskRow} ${task.status === 'done' ? s.done : ''}`}>
      <span className={`${s.priority} ${['high', 'urgent'].includes(task.priority) ? s.priorityHigh : ''}`} aria-label={`Priority ${task.priority}`} />
      <button className={`${s.check} ${task.status === 'done' ? s.checked : ''}`} onClick={() => toggle.mutate(task)} aria-label={task.status === 'done' ? `Reopen ${task.title}` : `Complete ${task.title}`} aria-pressed={task.status === 'done'} disabled={toggle.isPending}>
        {task.status === 'done' && <Check size={15} aria-hidden />}
      </button>
      <Link className={s.rowMain} to={`/tasks/item/${task.id}`}>
        <span className={s.rowTitle}>{task.is_locked ? <><LockKeyhole size={14} aria-hidden /> Locked task</> : task.title}</span>
        {!compact && <span className={s.rowMeta}>
          {task.due_on && <span>{formatShortDate(task.due_on)}</span>}
          {task.status === 'blocked' && <span>Waiting{task.waiting_on ? ` on ${task.waiting_on}` : ''}</span>}
          {space && <span className={s.spaceChip}><span className={s.spaceDot} />{space.short_label}</span>}
        </span>}
      </Link>
    </li>
  );
}
