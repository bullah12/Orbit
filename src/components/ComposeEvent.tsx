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
        className="min-w-40 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[color:var(--text-faint)]"
      />

      <label className="flex items-center gap-1.5">
        <span className="sr-only">Date</span>
        <input
          type="date"
          name="onDate"
          defaultValue={defaultDate}
          required
          className="faint rounded bg-transparent text-[11px] outline-none"
        />
      </label>

      <label className="faint flex items-center gap-1 text-[11px]">
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
              className="faint rounded bg-transparent text-[11px] outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="sr-only">End time</span>
            <input
              type="time"
              name="endTime"
              defaultValue="10:00"
              required
              className="faint rounded bg-transparent text-[11px] outline-none"
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
          className="faint rounded bg-transparent text-[11px] outline-none"
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
            className="faint rounded bg-transparent text-[11px] outline-none"
          >
            <option value="">Default calendar</option>
            {calendarOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
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
        className="rounded px-2 py-1 text-[12px] font-medium"
        style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
      >
        Add
      </button>
    </form>
  );
}
