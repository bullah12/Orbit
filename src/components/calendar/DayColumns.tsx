import { hourLines, layoutDay, splitDay, type CalendarView } from '@/lib/calendar';
import {
  formatDate,
  londonDayISO,
  londonDayMinutes,
  minutesIntoLondonDay,
  type DateOnly,
} from '@/lib/format';
import type { CalendarItem } from '@/lib/queries/events';
import { EventBlock } from './EventBlock';

/**
 * The day and week grids. One component: a week is seven day columns, and
 * writing it twice is how the two drift apart.
 *
 * Positions come from src/lib/calendar.ts as fractions of the day's real
 * length, so 25 October has 25 hours of grid and every block still lands where
 * it belongs. Nothing here computes a time.
 *
 * Keyboard: blocks are links in chronological DOM order per day, so tabbing
 * through a day reads it in the order it happens. The all-day banner comes
 * first, as it does visually.
 */
export function DayColumns({
  days,
  items,
  today,
  view,
}: {
  days: DateOnly[];
  items: CalendarItem[];
  today: DateOnly;
  view: CalendarView;
}) {
  // A fixed pixel height per day rather than a fraction of the viewport: a
  // dense calendar that rescales as the window changes is unreadable.
  const gridHeight = 960;

  return (
    <div className="flex-1 overflow-auto">
      <div
        className="grid min-w-max"
        style={{ gridTemplateColumns: `3.25rem repeat(${days.length}, minmax(9rem, 1fr))` }}
      >
        {/* --- day headings ------------------------------------------------ */}
        <div className="hairline sticky top-0 z-20 border-b border-r" style={{ background: 'var(--bg-sunken)' }} />
        {days.map((day) => (
          <div
            key={`head-${day}`}
            className="hairline sticky top-0 z-20 border-b border-r px-2 py-1.5"
            style={{ background: day === today ? 'var(--bg-hover)' : 'var(--bg-sunken)' }}
          >
            <DayHeading day={day} today={today} view={view} />
          </div>
        ))}

        {/* --- all-day banner ---------------------------------------------- */}
        <div
          className="hairline border-b border-r px-1 py-1 text-right text-[10px] leading-tight"
          style={{ background: 'var(--bg-sunken)' }}
        >
          <span className="faint">All day</span>
        </div>
        {days.map((day) => {
          const { allDay } = splitDay(items, day);
          return (
            <div key={`allday-${day}`} className="hairline flex flex-col gap-0.5 border-b border-r p-0.5">
              {allDay.map((item) => (
                <div key={item.key} className="min-h-[1.4rem]">
                  <EventBlock item={item} compact={days.length > 1} />
                </div>
              ))}
              {allDay.length === 0 && <div className="h-[1.4rem]" aria-hidden="true" />}
            </div>
          );
        })}

        {/* --- hour gutter -------------------------------------------------- */}
        <div className="hairline relative border-r" style={{ height: gridHeight }}>
          {hourLines(days[0] ?? today).map((line, i) => (
            <span
              key={`${line.label}-${i}`}
              className="faint absolute right-1 -translate-y-1/2 text-[10px] tabular-nums"
              style={{ top: `${line.top * 100}%` }}
            >
              {line.label}
            </span>
          ))}
        </div>

        {/* --- day columns -------------------------------------------------- */}
        {days.map((day) => {
          const { timed } = splitDay(items, day);
          const placed = layoutDay(timed, day);
          return (
            <div
              key={`col-${day}`}
              className="hairline relative border-r"
              style={{
                height: gridHeight,
                background: day === today ? 'var(--bg-hover)' : undefined,
              }}
            >
              {hourLines(day).map((line, i) => (
                <div
                  key={`line-${i}`}
                  className="hairline absolute inset-x-0 border-t"
                  style={{ top: `${line.top * 100}%` }}
                  aria-hidden="true"
                />
              ))}
              <NowLine day={day} today={today} />
              {placed.map(({ item, top, height, column, columns, span }) => (
                <div
                  key={item.key}
                  className="absolute"
                  style={{
                    top: `${top * 100}%`,
                    height: `${height * 100}%`,
                    left: `calc(${(column / columns) * 100}% + 1px)`,
                    width: `calc(${(1 / columns) * 100}% - 2px)`,
                  }}
                >
                  <EventBlock
                    item={item}
                    compact={height * londonDayMinutes(day) < 45 || days.length > 1}
                    continuesFrom={span.continuesFrom}
                    continuesTo={span.continuesTo}
                  />
                </div>
              ))}
              {placed.length === 0 && (
                <span className="sr-only">Nothing on {formatDate(day)}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayHeading({ day, today, view }: { day: DateOnly; today: DateOnly; view: CalendarView }) {
  const d = new Date(`${day}T00:00:00Z`);
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' }).format(d);
  const dayNum = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric' }).format(d);
  const month = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short' }).format(d);
  const isToday = day === today;

  return (
    <a
      href={`/calendar/day?date=${day}`}
      className="day-heading flex items-baseline gap-1.5"
      aria-label={`${weekday} ${dayNum} ${month}${isToday ? ', today' : ''}`}
    >
      <span className={isToday ? 'text-[12px] font-semibold' : 'muted text-[12px] font-medium'}>
        {view === 'day' ? new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long' }).format(d) : weekday}
      </span>
      <span className={isToday ? 'text-[13px] font-semibold tabular-nums' : 'text-[13px] tabular-nums'}>
        {dayNum}
      </span>
      <span className="faint text-[10px]">{month}</span>
      {isToday && <span className="sr-only">(today)</span>}
    </a>
  );
}

/**
 * The current-time line. Rendered on the server, so it is correct at page load
 * and does not move afterwards — a ticking line would mean a client component
 * and a re-render every minute for a line nobody is watching.
 */
function NowLine({ day, today }: { day: DateOnly; today: DateOnly }) {
  if (day !== today) return null;
  const now = new Date();
  if (londonDayISO(now) !== day) return null;
  const fraction = Math.max(0, Math.min(1, minutesIntoLondonDay(now) / londonDayMinutes(day)));
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 border-t"
      style={{ top: `${fraction * 100}%`, borderColor: 'var(--danger)' }}
      aria-hidden="true"
    />
  );
}
