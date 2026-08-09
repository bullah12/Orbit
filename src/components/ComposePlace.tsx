'use client';

import { useState } from 'react';
import { createPlace } from '@/app/actions';
import { SpaceIndicator } from './SpaceIndicator';
import { Icon } from './Icon';
import type { SpaceSummary } from '@/lib/queries/spaces';
import type { CategoryOption } from '@/lib/queries/tasks';

/**
 * Adding a place.
 *
 * Same shape as ComposeTask and ComposePerson: the space is a visible row of
 * chips, never a dropdown, because it is the decision being made. A place
 * carries an address and a postcode — enough for the geocoder to work with —
 * and nothing else; coordinates and notes are on the detail page.
 */
export function ComposePlace({
  spaces,
  categories,
  defaultSpaceId,
}: {
  spaces: SpaceSummary[];
  categories: Record<string, CategoryOption[]>;
  defaultSpaceId?: string;
}) {
  const writable = spaces.filter((s) => s.canWrite);
  const initial = writable.find((s) => s.id === defaultSpaceId) ?? writable[0];
  const [spaceId, setSpaceId] = useState(initial?.id ?? '');

  if (writable.length === 0 || !initial) return null;

  const options = categories[spaceId] ?? [];

  return (
    <form
      action={createPlace}
      className="hairline flex flex-wrap items-center gap-2 border-b px-3 py-2"
      style={{ background: 'var(--bg-raised)' }}
      aria-label="Add a place"
    >
      <Icon name="plus" size={14} className="faint" />
      <input
        name="name"
        placeholder="Add a place…"
        aria-label="Name"
        autoComplete="off"
        required
        className="min-w-40 flex-1 bg-transparent text-sm outline-none placeholder:text-[color:var(--text-faint)]"
      />
      <input
        name="addressText"
        placeholder="Address"
        aria-label="Address"
        autoComplete="off"
        className="min-w-32 flex-1 bg-transparent text-xs outline-none placeholder:text-[color:var(--text-faint)]"
      />
      <input
        name="postcode"
        placeholder="Postcode"
        aria-label="Postcode"
        autoComplete="off"
        size={9}
        className="w-24 bg-transparent text-xs uppercase outline-none placeholder:text-[color:var(--text-faint)]"
      />

      <label className="flex items-center gap-1.5">
        <span className="sr-only">Category</span>
        <select
          name="categoryId"
          key={spaceId}
          defaultValue=""
          className="faint rounded bg-transparent text-2xs outline-none"
        >
          <option value="">No category</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

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
        className="rounded px-2 py-1 text-xs font-medium btn-primary"
      >
        Add
      </button>
    </form>
  );
}
