'use client';

import { useState } from 'react';
import { createEvent } from '@/app/actions';
import { SpaceIndicator } from './SpaceIndicator';
import { Icon } from './Icon';
import type { SpaceSummary } from '@/lib/queries/spaces';
import type { CategoryOption } from '@/lib/queries/tasks';
import type { CalendarOption } from '@/lib/queries/events';

/**
 * Compose an event.
 *
 * Same contract as ComposeTask: the space is chosen as a visible chip, not a
 * dropdown, because this is the moment somebody decides who else will see it.
 * Client-side for the same reason too — categories and calendars belong to a
 * space, so changing the space has to change both lists without a round trip.
 *
 * Times are wall-clock and are turned into instants on the server, in London,
 * by src/lib/format.ts. The browser's timezone never enters into it.
 */
export function ComposeEvent({
  spaces,
  categories,
  calendars,
  defaultDate,
}: {
  spaces: SpaceSummary[];
  categories: Record<string, CategoryOption[]>;
  calendars: Record<string, CalendarOption[]>;
  defaultDate: string;
}) {
  const writable = spaces.filter((s) => s.canWrite);
  const initial = writable[0];
  const [spaceId, setSpaceId] = useState(initial?.id ?? '');
  const [allDay, setAllDay] = useState(false);
  const [repeat, setRepeat] = useState('');

  if (writable.length === 0 || !initial) return null;

  const categoryOptions = categories[spaceId] ?? [];
  const calendarOptions = (calendars[spaceId] ?? []).filter((c) => c.isWritable);

  return (
    <form
      action={createEvent}
      className="hairline flex flex-wrap items-center gap-2 border-b px-3 py-2"
      style={{ background: 'var(--bg-raised)' }}
      aria-label="Add an event"
    >
      <Icon name="plus" size={14} className="faint" />
      <input
        name="title"
        placeholder="Add an event…"
        aria-label="Event title"
        autoComplete="off"
        required
        className="min-w-40 flex-1 bg-transparent text-sm outline-none placeholder:text-[color:var(--text-faint)]"
      />

      <label className="flex items-center gap-1.5">
        <span className="sr-only">Date</span>
        <input
          type="date"
          name="onDate"
          defaultValue={defaultDate}
          required
          className="faint rounded bg-transparent text-2xs outline-none"
        />
      </label>

      <label className="faint flex items-center gap-1 text-2xs">
        <input
          type="checkbox"
          name="allDay"
          value="true"
          checked={allDay}
          onChange={(e) => setAllDay(e.target.checked)}
        />
        All day
      </label>

      {!allDay && (
        <>
          <label className="flex items-center gap-1.5">
            <span className="sr-only">Start time</span>
            <input
              type="time"
              name="startTime"
              defaultValue="09:00"
              required
              className="faint rounded bg-transparent text-2xs outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="sr-only">End time</span>
            <input
              type="time"
              name="endTime"
              defaultValue="10:00"
              required
              className="faint rounded bg-transparent text-2xs outline-none"
            />
          </label>
        </>
      )}

      <label className="flex items-center gap-1.5">
        <span className="sr-only">Category</span>
        <select
          name="categoryId"
          key={`cat-${spaceId}`}
          defaultValue=""
          className="faint rounded bg-transparent text-2xs outline-none"
        >
          <option value="">No category</option>
          {categoryOptions.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>

      {calendarOptions.length > 1 && (
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Calendar</span>
          <select
            name="calendarId"
            key={`cal-${spaceId}`}
            defaultValue=""
            className="faint rounded bg-transparent text-2xs outline-none"
          >
            <option value="">Default calendar</option>
            {calendarOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      )}

      {/* Phase 2 could store and expand a repeat and had no way to make one:
          a recurring event could only arrive from an .ics file or a provider.
          A repeat is still one row plus an RRULE — this writes the rule, it
          never writes expanded copies. */}
      <label className="flex items-center gap-1.5">
        <span className="sr-only">Repeats</span>
        <select
          name="repeatFreq"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          className="faint rounded bg-transparent text-2xs outline-none"
        >
          <option value="">Does not repeat</option>
          <option value="DAILY">Every day</option>
          <option value="WEEKLY">Every week</option>
          <option value="MONTHLY">Every month</option>
          <option value="YEARLY">Every year</option>
        </select>
      </label>

      {repeat !== '' && (
        <>
          <label className="faint flex items-center gap-1 text-2xs">
            every
            <input
              type="number"
              name="repeatInterval"
              defaultValue={1}
              min={1}
              max={99}
              aria-label="How many days, weeks, months or years between repeats"
              className="hairline w-12 rounded border bg-transparent px-1 text-2xs"
            />
            {repeat === 'DAILY' ? 'days' : repeat === 'WEEKLY' ? 'weeks' : repeat === 'MONTHLY' ? 'months' : 'years'}
          </label>

          {repeat === 'WEEKLY' && (
            <fieldset className="flex items-center gap-1">
              <legend className="sr-only">Which days it repeats on</legend>
              {(
                [
                  ['MO', 'Monday'], ['TU', 'Tuesday'], ['WE', 'Wednesday'], ['TH', 'Thursday'],
                  ['FR', 'Friday'], ['SA', 'Saturday'], ['SU', 'Sunday'],
                ] as const
              ).map(([code, name]) => (
                <label key={code} className="faint cursor-pointer text-2xs">
                  <input type="checkbox" name="repeatByDay" value={code} className="peer sr-only" />
                  <span className="sr-only">{name}</span>
                  <span
                    aria-hidden="true"
                    className="hairline block rounded border px-1 opacity-45 peer-checked:opacity-100 peer-focus-visible:outline peer-focus-visible:outline-2"
                  >
                    {code}
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          <label className="faint flex items-center gap-1 text-2xs">
            until
            <input
              type="date"
              name="repeatUntil"
              aria-label="The date it stops repeating; leave empty for forever"
              className="faint rounded bg-transparent text-2xs outline-none"
            />
          </label>
        </>
      )}

      <fieldset className="flex items-center gap-1">
        <legend className="sr-only">Space</legend>
        {writable.map((s) => (
          <label key={s.id} className="cursor-pointer">
            <input
              type="radio"
              name="spaceId"
              value={s.id}
              checked={s.id === spaceId}
              onChange={() => setSpaceId(s.id)}
              className="peer sr-only"
            />
            <span className="block rounded opacity-45 peer-checked:opacity-100 peer-focus-visible:outline peer-focus-visible:outline-2">
              <SpaceIndicator space={s} />
            </span>
          </label>
        ))}
      </fieldset>

      <button
        type="submit"
        className="rounded px-2 py-1 text-xs font-medium"
        style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
      >
        Add
      </button>
    </form>
  );
}
