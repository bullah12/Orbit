'use client';

import { useState } from 'react';
import { createTask } from '@/app/actions';
import { SpaceIndicator } from './SpaceIndicator';
import { Icon } from './Icon';
import type { SpaceSummary } from '@/lib/queries/spaces';
import type { CategoryOption } from '@/lib/queries/tasks';

/**
 * The compose surface.
 *
 * The space indicator requirement applies here too, and it matters more here
 * than on a row: this is the moment a user decides who else will see the thing
 * they are typing. The chosen space is shown as the same chip they will see on
 * the row afterwards, so there is no translation step.
 *
 * It is a client component for one reason: categories belong to a space, so
 * changing the space has to change the category list without a round trip.
 * Rendering every space's categories at once and hoping the server sorts it out
 * is how a task ends up silently uncategorised.
 */
export function ComposeTask({
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

  /**
   * On a phone the bar was three rows — roughly a quarter of the first screen
   * of every list — for a control that is used occasionally. Collapsed, it is
   * one row; touching the title opens the rest.
   *
   * This does **not** weaken the space safeguard. The chips are still chips and
   * still visible before anything can be typed, because focusing the title is
   * what opens them: there is no state in which somebody types a task without
   * the space being on screen. What is hidden is the row you have not reached
   * yet, not the decision.
   *
   * From `sm` up nothing is ever collapsed — the room is there, so the whole
   * bar stays visible and this state is not consulted.
   */
  const [expanded, setExpanded] = useState(false);

  if (writable.length === 0 || !initial) return null;

  const options = categories[spaceId] ?? [];
  const extras = expanded ? 'flex' : 'hidden sm:flex';

  return (
    <form
      action={createTask}
      className="hairline flex flex-wrap items-center gap-2 border-b px-3 py-2"
      style={{ background: 'var(--bg-raised)' }}
      aria-label="Add a task"
    >
      <Icon name="plus" size={14} className="faint" />
      <input
        name="title"
        placeholder="Add a task…"
        aria-label="Task title"
        autoComplete="off"
        onFocus={() => setExpanded(true)}
        required
        className="min-w-40 flex-1 bg-transparent text-sm outline-none placeholder:text-[color:var(--text-faint)]"
      />

      <label className={`${extras} items-center gap-1.5`}>
        <span className="sr-only">Due date</span>
        <input
          type="date"
          name="dueOn"
          className="faint rounded bg-transparent text-2xs outline-none"
        />
      </label>

      <label className={`${extras} items-center gap-1.5`}>
        <span className="sr-only">Category</span>
        <select
          name="categoryId"
          className="faint rounded bg-transparent text-2xs outline-none"
          // Keyed on the space so the browser resets the selection when the
          // space changes, rather than keeping a category from the old one.
          key={spaceId}
          defaultValue=""
        >
          <option value="">No category</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {/* Radio group, not a select: the chips have to be visible to be a
          safeguard. A collapsed dropdown hides the very decision this is for. */}
      <fieldset className={`${extras} items-center gap-1`}>
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
