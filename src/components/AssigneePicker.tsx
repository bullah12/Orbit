'use client';

import { useRef } from 'react';
import { setTaskAssignee } from '@/app/actions';
import type { AssigneeOption } from '@/lib/queries/tasks';

/**
 * Whose job it is, settable from the row — edge 32.
 *
 * **On the row and not on the compose bar**, which is a decision recorded twice
 * and standing. The compose bar already carries a title, a date, a category and
 * one chip per writable space, and on a phone that was three rows before
 * anything was added. A task's owner is also the thing most likely to change
 * *after* it exists — "actually, can you do this one" — so the row is where the
 * control is wanted anyway. `@danny` in capture has set it since Phase 5 and
 * still does.
 *
 * A `select` rather than a menu of buttons: it is one native control, it works
 * on a phone without a popover, it is in the tab order for free, and it does
 * not change the row's height. The form submits on change so there is no Save
 * button on every row — and there is a `noscript`-shaped fallback in the sense
 * that the button below is rendered and merely hidden, so a browser that never
 * runs this component's script still has a way to submit.
 */
export function AssigneePicker({
  taskId,
  assigneeId,
  options,
  label,
}: {
  taskId: string;
  assigneeId: string | null;
  options: AssigneeOption[];
  /** The task's title, for the control's accessible name. */
  label: string;
}) {
  const form = useRef<HTMLFormElement>(null);

  return (
    <form ref={form} action={setTaskAssignee} className="flex shrink-0 items-center">
      <input type="hidden" name="taskId" value={taskId} />
      <select
        name="assigneeId"
        defaultValue={assigneeId ?? ''}
        aria-label={`Who “${label}” is for`}
        onChange={() => form.current?.requestSubmit()}
        // Deliberately quiet: this sits in the metadata cluster beside the
        // category chip and the due date, and a bordered control on every row
        // of a dense list would out-shout the titles. It takes an edge on hover
        // and focus, so it is findable without being loud.
        className="faint max-w-[7rem] truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-2xs hover:border-[var(--line)] focus:border-[var(--line)]"
      >
        <option value="">Unassigned</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {/* Present for a browser that submits the form without the change
          handler; hidden from sight and from the tab order otherwise. */}
      <button type="submit" className="sr-only" tabIndex={-1}>
        Save who this is for
      </button>
    </form>
  );
}
