import { createTask } from '@/app/actions';
import { SpaceIndicator } from './SpaceIndicator';
import { Icon } from './Icon';
import type { SpaceSummary } from '@/lib/queries/spaces';

/**
 * The compose surface.
 *
 * The space indicator requirement applies here too, and it matters more here
 * than on a row: this is the moment a user decides who else will see the thing
 * they are typing. The chosen space is shown as the same chip they will see on
 * the row afterwards, so there is no translation step.
 */
export function ComposeTask({
  spaces,
  defaultSpaceId,
}: {
  spaces: SpaceSummary[];
  defaultSpaceId?: string;
}) {
  const writable = spaces.filter((s) => s.canWrite);
  if (writable.length === 0) return null;

  const selected = writable.find((s) => s.id === defaultSpaceId) ?? writable[0]!;

  return (
    <form
      action={createTask}
      className="hairline flex flex-wrap items-center gap-2 border-b px-3 py-2"
      style={{ background: 'var(--bg-raised)' }}
    >
      <Icon name="plus" size={14} className="faint" />
      <input
        name="title"
        placeholder="Add a task…"
        autoComplete="off"
        required
        className="min-w-40 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[color:var(--text-faint)]"
      />

      <label className="flex items-center gap-1.5">
        <span className="sr-only">Due date</span>
        <input
          type="date"
          name="dueOn"
          className="faint rounded bg-transparent text-[11px] outline-none"
        />
      </label>

      {/* Radio group, not a select: the chips have to be visible to be a
          safeguard. A collapsed dropdown hides the very decision this is for. */}
      <fieldset className="flex items-center gap-1">
        <legend className="sr-only">Space</legend>
        {writable.map((s) => (
          <label key={s.id} className="cursor-pointer">
            <input
              type="radio"
              name="spaceId"
              value={s.id}
              defaultChecked={s.id === selected.id}
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
