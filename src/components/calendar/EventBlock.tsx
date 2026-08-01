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
        {/*
          The time is dropped from a compact block and kept everywhere else.
          A block in a week column is already positioned against the hour
          gutter, so the time was being said twice — and it was costing about a
          third of the width, which is why five identical standups all read
          "10:30 Team st…" and could not be told apart. The title is the only
          thing that distinguishes them, so the title is what gets the room.
          The exact time is still on the block's `title` and its `aria-label`.
        */}
        {!compact && <span className="faint shrink-0 tabular-nums">{time}</span>}
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
  const accent = `var(--c-${item.category?.colour ?? item.space.colour}, var(--c-slate))`;

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
      className={`row-hover rounded-sm border-y border-l-2 border-r ${className}`}
      // Category colour on the left edge only, hairline on the other three.
      // globals.css specifies exactly this next to `.block`, with the reason
      // written beside it: filling the block turns a stack of them into a
      // colour chart. Every border was taking the accent, so a week of events
      // read as a grid of coloured rectangles rather than as a list of things.
      style={{
        borderColor: 'var(--line)',
        borderLeftColor: accent,
        background: 'var(--bg-raised)',
      }}
      aria-label={`${item.title || 'Untitled event'}, ${
        item.allDay ? 'all day' : formatTime(item.startsAt)
      }, ${item.space.name}`}
    >
      {body}
    </Link>
  );
}
