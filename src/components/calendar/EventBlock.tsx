import Link from 'next/link';
import { Icon } from '../Icon';
import { SpaceIndicator } from '../SpaceIndicator';
import type { CalendarItem } from '@/lib/queries/events';
import { formatTime } from '@/lib/format';

/**
 * One block in the calendar.
 *
 * Two shapes, and the difference is the whole of decision 3: an event the
 * caller can read carries its title, its category and a link; a `free_busy`
 * block carries a time, a space, and the word "Busy". There is no variant in
 * between and no prop that turns one into the other — a block is anonymous
 * because the *query* returned no title, not because this component hid one.
 *
 * The space indicator is on every block, both kinds. It is what makes a merged
 * calendar readable rather than a pile of rectangles.
 */
export function EventBlock({
  item,
  compact = false,
  continuesFrom = false,
  continuesTo = false,
}: {
  item: CalendarItem;
  compact?: boolean;
  continuesFrom?: boolean;
  continuesTo?: boolean;
}) {
  const time = item.allDay ? 'All day' : formatTime(item.startsAt);
  const accent = item.isBusy
    ? 'var(--c-slate)'
    : `var(--c-${item.category?.colour ?? item.space.colour}, var(--c-slate))`;

  const body = (
    <>
      <span className="flex items-baseline gap-1">
        {continuesFrom && <Icon name="arrow_right" size={9} className="faint shrink-0" />}
        {/*
          The space indicator is on *every* block, including the narrow ones in
          a week column. It moves inline with the time rather than being
          dropped: a merged calendar where you cannot tell whose event it is at
          a glance is the thing this requirement exists to prevent.
        */}
        {compact && <SpaceIndicator space={item.space} />}
        <span className="faint shrink-0 tabular-nums">{time}</span>
        <span className="truncate font-medium">
          {item.isBusy ? 'Busy' : item.title || 'Untitled'}
        </span>
      </span>
      {!compact && (
        <span className="flex flex-wrap items-center gap-1">
          <SpaceIndicator space={item.space} />
          {!item.isBusy && item.category && (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 text-[10px]"
              style={{ color: `var(--c-${item.category.colour}, var(--c-slate))` }}
            >
              <Icon name={item.category.icon} size={9} strokeWidth={2} />
              {item.category.name}
            </span>
          )}
          {!item.isBusy && item.isRecurring && (
            <Icon name="undo" size={9} className="faint" aria-label="Repeats" />
          )}
          {!item.isBusy && item.attendeeCount > 0 && (
            <span className="faint inline-flex items-center gap-0.5 text-[10px]">
              <Icon name="users" size={9} />
              {item.attendeeCount}
            </span>
          )}
          {continuesTo && <Icon name="arrow_right" size={9} className="faint" />}
        </span>
      )}
    </>
  );

  const className =
    'flex h-full flex-col gap-0.5 overflow-hidden rounded-sm border-l-2 px-1 py-0.5 text-[11px] leading-tight';
  const style = {
    borderColor: accent,
    background: item.isBusy ? 'var(--bg-sunken)' : 'var(--bg-raised)',
    // A busy block is deliberately quieter than a real event: it is a fact
    // about somebody else's time, not something to act on.
    opacity: item.isBusy ? 0.85 : 1,
  };

  if (item.isBusy) {
    return (
      <div
        className={`hairline border-y border-r ${className}`}
        style={style}
        title={`${item.space.name} — busy, ${time}`}
      >
        {body}
      </div>
    );
  }

  // A recurring event's block names which occurrence was clicked, by its own
  // start instant — RFC 5545's RECURRENCE-ID. Every occurrence of a series links
  // to the same row, so without this the detail page cannot tell Tuesday's
  // instance from next Tuesday's, and "skip this one" has nothing to skip.
  return (
    <Link
      href={
        item.isRecurring
          ? `/calendar/event/${item.id}?on=${encodeURIComponent(item.startsAt)}`
          : `/calendar/event/${item.id}`
      }
      className={`hairline row-hover border-y border-r ${className}`}
      style={style}
      aria-label={`${item.title || 'Untitled event'}, ${
        item.allDay ? 'all day' : formatTime(item.startsAt)
      }, ${item.space.name}`}
    >
      {body}
    </Link>
  );
}
