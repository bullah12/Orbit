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
              className="inline-flex shrink-0 items-center gap-0.5 text-2xs"
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
            <span className="faint inline-flex items-center gap-0.5 text-2xs">
              <Icon name="users" size={9} />
              {item.attendeeCount}
            </span>
          )}
          {continuesTo && <Icon name="arrow_right" size={9} className="faint" />}
        </span>
      )}
    </>
  );

  const className = 'flex h-full flex-col gap-0.5 overflow-hidden px-1 py-0.5 text-2xs';

  if (item.isBusy) {
    // A busy block is quieter than a real event by shape rather than by colour:
    // .busy is the sunken substrate, the dashed edge and the italic muted text,
    // and it spends none of the ten category colours on somebody else's time.
    // No inline style here — it would out-rank the class it is meant to wear.
    return (
      <div className={`busy ${className}`} title={`${item.space.name} — busy, ${time}`}>
        {body}
      </div>
    );
  }

  // Past the early return, the union has narrowed to a real event, which is the
  // only shape that has a category to take a colour from.
  const colour = item.category?.colour ?? item.space.colour;
  const accent = `var(--c-${colour}, var(--c-slate))`;

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
      className={`row-hover rounded border-l-2 ${className}`}
      // The dense chip form of .block: same tokens, smaller geometry. The fill
      // is the category's own -bg and the text its foreground, which is the one
      // pair measured against each other in the contrast test.
      style={{
        borderLeftColor: accent,
        background: `var(--c-${colour}-bg, var(--c-slate-bg))`,
        color: accent,
      }}
      aria-label={`${item.title || 'Untitled event'}, ${
        item.allDay ? 'all day' : formatTime(item.startsAt)
      }, ${item.space.name}`}
    >
      {body}
    </Link>
  );
}
