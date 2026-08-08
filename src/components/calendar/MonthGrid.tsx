import Link from 'next/link';
import { byDay, monthGrid, monthOf } from '@/lib/calendar';
import { plural, type DateOnly } from '@/lib/format';
import { DEFAULT_WEEK_START, type WeekStart } from '@/lib/prefs';
import type { CalendarItem } from '@/lib/queries/events';
import { EventBlock } from './EventBlock';

/**
 * The month view. Six rows, always — a grid that changes height as you page
 * through the year makes the whole page jump.
 *
 * `weekStart` cuts the rows and rotates the column headings together, from one
 * value, so the labels cannot end up describing a different grid from the one
 * drawn beneath them.
 *
 * A cell shows at most three blocks and then says how many more there are,
 * linking to that day. Truncating without saying so is how a calendar quietly
 * lies about a busy Tuesday.
 */
const MAX_PER_CELL = 3;

export function MonthGrid({
  anchor,
  items,
  today,
  weekStart = DEFAULT_WEEK_START,
}: {
  anchor: DateOnly;
  items: CalendarItem[];
  today: DateOnly;
  weekStart?: WeekStart;
}) {
  const weeks = monthGrid(anchor, weekStart);
  const days = weeks.flat();
  const grouped = byDay(items, days);
  const thisMonth = monthOf(anchor);

  // Rotated rather than written twice: one list, cut where the week is cut.
  const NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const headings = weekStart === 'sunday' ? [NAMES[6]!, ...NAMES.slice(0, 6)] : NAMES;

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="grid grid-cols-7">
        {headings.map((h) => (
          <div
            key={h}
            className="hairline faint border-b border-r px-2 py-1 text-2xs font-semibold uppercase tracking-wider"
            style={{ background: 'var(--bg-sunken)' }}
          >
            {h}
          </div>
        ))}
        {days.map((day) => {
          const dayItems = grouped.get(day) ?? [];
          const shown = dayItems.slice(0, MAX_PER_CELL);
          const hidden = dayItems.length - shown.length;
          const outside = monthOf(day) !== thisMonth;

          return (
            <div
              key={day}
              className="hairline flex min-h-[6.5rem] flex-col gap-0.5 border-b border-r p-1"
              style={{
                background:
                  day === today ? 'var(--bg-hover)' : outside ? 'var(--bg-sunken)' : undefined,
              }}
            >
              <Link
                href={`/calendar/day?date=${day}`}
                className={
                  day === today
                    ? 'day-heading self-start rounded px-1 text-xs font-semibold tabular-nums'
                    : outside
                      ? 'day-heading faint self-start px-1 text-xs tabular-nums'
                      : 'day-heading muted self-start px-1 text-xs tabular-nums'
                }
                aria-label={`${day}, ${plural(dayItems.length, 'entry', 'entries')}`}
              >
                {Number(day.slice(8, 10))}
              </Link>
              {shown.map((item) => (
                <EventBlock key={item.key} item={item} compact />
              ))}
              {hidden > 0 && (
                <Link href={`/calendar/day?date=${day}`} className="faint px-1 text-2xs">
                  {hidden} more
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
