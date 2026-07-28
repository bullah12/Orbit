'use client';

import { useState } from 'react';
import { createTravelSession } from '@/app/actions';
import { SpaceIndicator } from './SpaceIndicator';
import type { SpaceSummary } from '@/lib/queries/spaces';
import type { PlacePickerRow } from '@/lib/queries/places';

/**
 * Start Travel Mode by hand.
 *
 * The other way in is a multi-day event in the calendar. There is no third way,
 * and in particular there is no "detect that I am away" — decision 5, and the
 * reason there is no location permission anywhere in this app.
 */
export function ComposeTravelSession({
  spaces,
  places,
  today,
  defaultSpaceId,
}: {
  spaces: SpaceSummary[];
  places: PlacePickerRow[];
  today: string;
  defaultSpaceId?: string;
}) {
  const writable = spaces.filter((s) => s.canWrite);
  const initial = writable.find((s) => s.id === defaultSpaceId) ?? writable[0];
  const [spaceId, setSpaceId] = useState(initial?.id ?? '');

  if (writable.length === 0 || !initial) return null;

  const options = places.filter((p) => p.space.id === spaceId);

  return (
    <form
      action={createTravelSession}
      className="surface flex flex-wrap items-end gap-2 rounded-md p-3"
      aria-label="Start a trip"
    >
      <fieldset className="flex items-center gap-1 self-center">
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

      <div className="flex min-w-44 flex-1 flex-col gap-1">
        <label htmlFor="session-title" className="faint text-[11px] font-medium">
          Where to
        </label>
        <input id="session-title" name="title" required className="input" placeholder="Manchester" />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="session-start" className="faint text-[11px] font-medium">
          From
        </label>
        <input id="session-start" type="date" name="startDate" required defaultValue={today} className="input" />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="session-end" className="faint text-[11px] font-medium">
          Until
        </label>
        <input id="session-end" type="date" name="endDate" required defaultValue={today} className="input" />
      </div>

      <div className="flex min-w-40 flex-col gap-1">
        <label htmlFor="session-destination" className="faint text-[11px] font-medium">
          Staying at
        </label>
        <select
          id="session-destination"
          name="destinationPlaceId"
          key={spaceId}
          defaultValue=""
          className="input"
        >
          <option value="">Not a saved place</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        className="rounded px-3 py-1.5 text-[12px] font-medium"
        style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
      >
        Start a trip
      </button>
    </form>
  );
}
