import Link from 'next/link';
import { SMART_LISTS, type SmartListKey } from '@/lib/smartlists';

/**
 * The nine smart lists, as one scrollable row.
 *
 * On a wide screen the rail lists all nine down the side and this is not
 * rendered. On a phone there is no rail, and the alternative to this row was
 * "open More, find Lists, pick one, come back" for a switch somebody makes
 * several times a minute.
 *
 * **These are links to the nine routes, not client state.** `/tasks/overdue`
 * is a URL somebody bookmarks, sends, and lands on from the Home page's
 * "see all"; it has to keep working, and the segment has to be right when it
 * does. Deriving the active segment from the route param rather than from
 * `useState` is what makes that true — it also keeps the whole page a server
 * component and keeps back and forward meaning what they say.
 *
 * The counts are the same numbers the rail shows, from the same query, scoped
 * to the same space. A segment reading "Overdue" next to a rail reading
 * "Overdue 34" would be two answers to one question.
 */

/** The rail's order, which is the order somebody has already learnt. */
const ORDER: SmartListKey[] = [
  'mine', 'today', 'overdue', 'upcoming', 'inbox', 'waiting', 'someday', 'all', 'done',
];

export function TaskListTabs({
  active,
  counts,
  spaceId,
}: {
  active: SmartListKey;
  counts: Record<SmartListKey, number>;
  /** Carried through every segment, so switching list does not silently drop
   *  the space somebody is standing in. */
  spaceId?: string | null;
}) {
  const suffix = spaceId ? `?space=${encodeURIComponent(spaceId)}` : '';

  return (
    <nav
      aria-label="Task lists"
      className="segbar hairline border-b md:hidden"
      style={{ background: 'var(--bg-raised)' }}
    >
      {ORDER.map((key) => (
        <Link
          key={key}
          href={`/tasks/${key}${suffix}` as never}
          aria-current={key === active ? 'page' : undefined}
        >
          {SMART_LISTS[key].label}
          {counts[key] > 0 && <span className="faint text-xs tabular-nums">{counts[key]}</span>}
        </Link>
      ))}
    </nav>
  );
}
