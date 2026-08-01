import Link from 'next/link';
import { Icon } from './Icon';
import { SpaceIndicator } from './SpaceIndicator';
import type { CalendarItem } from '@/lib/queries/events';
import {
  formatLongDate,
  formatTime,
  londonDayISO,
  type DateOnly,
} from '@/lib/format';
import { splitDay } from '@/lib/calendar';

/**
 * What is on, as a list rather than as a grid.
 *
 * The calendar is a *placement* tool — you open it already knowing the date.
 * This answers a different question, the one asked at breakfast: what is
 * happening, in order, starting now. So it is a column of blocks against a time
 * gutter, not seven columns of empty night hours.
 *
 * This is the surface `globals.css` was written for. `.block`, `.block-time`,
 * `.block-now` and `.now-line` were added to the stylesheet, contrast-checked
 * and documented when the revised design was adopted, and then nothing was
 * built that used them — nine utilities and four tokens sat dead. Everything
 * here wears them rather than inventing a second vocabulary beside them.
 *
 * Category colour lives on the block's left edge only. Filling the block turns
 * a stack of them into a colour chart, which is the note written next to
 * `.block` in the stylesheet.
 */
export function Agenda({
  items,
  days,
  today,
  now = new Date(),
}: {
  items: CalendarItem[];
  days: DateOnly[];
  today: DateOnly;
  now?: Date;
}) {
  const withEvents = days
    .map((day) => ({ day, timed: splitDay(items, day) }))
    .filter(({ timed }) => timed.allDay.length > 0 || timed.timed.length > 0);

  if (withEvents.length === 0) {
    return (
      <p className="faint px-5 py-6 text-sm">
        Nothing in the calendar{days.length > 1 ? ' for this range' : ' today'}.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-5 py-3">
      {withEvents.map(({ day, timed }) => (
        <section key={day} aria-label={formatLongDate(day)}>
          {/* A single day needs no heading — the page header already said which
              day it is. A range does, or the blocks run together. */}
          {days.length > 1 && (
            <h3 className="section-label mb-1.5">
              {day === today ? `Today — ${formatLongDate(day)}` : formatLongDate(day)}
            </h3>
          )}

          <ul className="flex flex-col gap-1.5">
            {timed.allDay.map((item) => (
              <AgendaRow key={item.key} item={item} allDay />
            ))}
            {timed.timed.map((item, i) => (
              <li key={item.key} className="contents">
                {/* The now-line goes between the last block that has started
                    and the first that has not, which is the only place it can
                    go in a list — an agenda has no fixed vertical scale to
                    position it against, unlike the calendar grid. */}
                {shouldPrecedeNowLine(timed.timed, i, day, now, today) && <NowLine now={now} />}
                <AgendaRow item={item} isNow={containsNow(item, now)} />
              </li>
            ))}
            {endsAfterLastBlock(timed.timed, day, now, today) && <NowLine now={now} />}
          </ul>
        </section>
      ))}
    </div>
  );
}

function AgendaRow({
  item,
  allDay = false,
  isNow = false,
}: {
  item: CalendarItem;
  allDay?: boolean;
  isNow?: boolean;
}) {
  const accent = item.isBusy
    ? 'var(--line-strong)'
    : `var(--c-${item.category?.colour ?? item.space.colour}, var(--c-slate))`;

  const body = (
    <>
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={item.isBusy ? 'muted italic' : 'font-medium'}>
          {item.isBusy ? 'Busy' : item.title || 'Untitled'}
        </span>
        {!item.isBusy && item.isRecurring && (
          <Icon name="undo" size={10} className="faint" aria-label="Repeats" />
        )}
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <SpaceIndicator space={item.space} />
        {!item.isBusy && item.category && (
          <span
            className="inline-flex shrink-0 items-center gap-0.5 text-2xs"
            style={{ color: `var(--c-${item.category.colour}, var(--c-slate))` }}
          >
            <Icon name={item.category.icon} size={10} strokeWidth={2} />
            {item.category.name}
          </span>
        )}
        {!item.isBusy && item.placeName && (
          <span className="faint inline-flex items-center gap-0.5 text-2xs">
            <Icon name="map_pin" size={10} />
            {item.placeName}
          </span>
        )}
        {!item.isBusy && item.attendeeCount > 0 && (
          <span className="faint inline-flex items-center gap-0.5 text-2xs">
            <Icon name="users" size={10} />
            {item.attendeeCount}
          </span>
        )}
      </span>
    </>
  );

  return (
    <li className="flex items-start gap-2">
      <span className="block-time shrink-0 pt-2 text-right" style={{ width: 'var(--gutter)' }}>
        {allDay ? 'All day' : formatTime(item.startsAt)}
      </span>
      {item.isBusy ? (
        // Somebody else's time is quieter by shape, not by a colour of its own.
        <div className="busy min-w-0 flex-1 px-2.5 py-2 text-sm">{body}</div>
      ) : (
        <Link
          href={
            item.isRecurring
              ? `/calendar/event/${item.id}?on=${encodeURIComponent(item.startsAt)}`
              : `/calendar/event/${item.id}`
          }
          className={`block row-hover min-w-0 flex-1 text-sm ${isNow ? 'block-now' : ''}`}
          style={isNow ? undefined : { borderLeftColor: accent }}
        >
          {body}
        </Link>
      )}
    </li>
  );
}

/**
 * The current time, as one accent hairline with a dot at the gutter edge.
 *
 * `.now-line-gutter` pulls the dot back across the time column, which is the
 * one place it does not sit at the line's own left edge.
 */
function NowLine({ now }: { now: Date }) {
  return (
    <li className="flex items-center gap-2" aria-hidden="true">
      <span className="block-time shrink-0 text-right" style={{ width: 'var(--gutter)' }}>
        now {formatTime(now)}
      </span>
      <span className="now-line now-line-gutter flex-1" />
    </li>
  );
}

function startOf(item: CalendarItem): number {
  return new Date(item.startsAt).getTime();
}

function containsNow(item: CalendarItem, now: Date): boolean {
  const t = now.getTime();
  return startOf(item) <= t && new Date(item.endsAt).getTime() > t;
}

/** Whether the line belongs immediately before the block at `i`. */
function shouldPrecedeNowLine(
  timed: CalendarItem[],
  i: number,
  day: DateOnly,
  now: Date,
  today: DateOnly,
): boolean {
  if (day !== today || londonDayISO(now) !== day) return false;
  const t = now.getTime();
  if (startOf(timed[i]!) <= t) return false;
  // Only before the *first* block that has not started, so the line appears once.
  return i === 0 || startOf(timed[i - 1]!) <= t;
}

/** The line goes last when everything on the day has already started. */
function endsAfterLastBlock(
  timed: CalendarItem[],
  day: DateOnly,
  now: Date,
  today: DateOnly,
): boolean {
  if (day !== today || londonDayISO(now) !== day || timed.length === 0) return false;
  return startOf(timed[timed.length - 1]!) <= now.getTime();
}
