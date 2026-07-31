'use client';

import { useState } from 'react';
import { createTravelLeg } from '@/app/actions';
import { SpaceIndicator } from './SpaceIndicator';
import { Icon } from './Icon';
import { LEG_MODES, LEG_MODE_LABEL } from '@/lib/travel';
import type { SpaceSummary } from '@/lib/queries/spaces';
import type { PlacePickerRow } from '@/lib/queries/places';
import type { TravelSessionRow } from '@/lib/queries/travel';

/**
 * Add a journey by hand.
 *
 * The space chips come first, as everywhere else, and choosing one filters both
 * place pickers: a leg lives in one space, and offering a place from another
 * would be offering a row the database will refuse to relate. Times are
 * optional — "I cycle to Stirchley and it takes twenty minutes" is a useful
 * thing to record without a clock attached.
 */
export function ComposeTravelLeg({
  spaces,
  places,
  sessions,
  day,
  defaultSpaceId,
}: {
  spaces: SpaceSummary[];
  places: PlacePickerRow[];
  sessions: TravelSessionRow[];
  day: string;
  defaultSpaceId?: string;
}) {
  const writable = spaces.filter((s) => s.canWrite);
  const initial = writable.find((s) => s.id === defaultSpaceId) ?? writable[0];
  const [spaceId, setSpaceId] = useState(initial?.id ?? '');

  if (writable.length === 0 || !initial) return null;

  const options = places.filter((p) => p.space.id === spaceId);
  const trips = sessions.filter((t) => t.space.id === spaceId);

  return (
    <form
      action={createTravelLeg}
      className="surface flex flex-wrap items-end gap-2 rounded-md p-3"
      aria-label="Add a journey"
    >
      <input type="hidden" name="onDate" value={day} />

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

      <div className="flex min-w-44 flex-col gap-1">
        <label htmlFor="leg-from" className="faint text-2xs font-medium">
          From
        </label>
        <select id="leg-from" name="fromPlaceId" key={`from-${spaceId}`} defaultValue="" className="input">
          <option value="">Somewhere else</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <Icon name="arrow_right" size={13} className="faint mb-2" />

      <div className="flex min-w-44 flex-col gap-1">
        <label htmlFor="leg-to" className="faint text-2xs font-medium">
          To
        </label>
        <select id="leg-to" name="toPlaceId" key={`to-${spaceId}`} defaultValue="" className="input">
          <option value="">Somewhere else</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="leg-mode" className="faint text-2xs font-medium">
          How
        </label>
        <select id="leg-mode" name="mode" defaultValue="car" className="input">
          {LEG_MODES.map((m) => (
            <option key={m} value={m}>
              {LEG_MODE_LABEL[m]}
            </option>
          ))}
        </select>
      </div>

      {trips.length > 0 && (
        <div className="flex min-w-40 flex-col gap-1">
          <label htmlFor="leg-session" className="faint text-2xs font-medium">
            Part of
          </label>
          <select id="leg-session" name="sessionId" key={`trip-${spaceId}`} defaultValue="" className="input">
            <option value="">No trip</option>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="leg-depart" className="faint text-2xs font-medium">
          Leaves
        </label>
        <input id="leg-depart" type="time" name="departTime" className="input" />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="leg-arrive" className="faint text-2xs font-medium">
          Arrives
        </label>
        <input id="leg-arrive" type="time" name="arriveTime" className="input" />
      </div>

      <button
        type="submit"
        className="rounded px-3 py-1.5 text-xs font-medium"
        style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
      >
        Add journey
      </button>

      <p className="faint w-full text-2xs">
        Leave the arrival empty and Orbit estimates it, including the few minutes
        either end that are not the moving part.
      </p>
    </form>
  );
}
