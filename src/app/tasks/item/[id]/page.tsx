import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { getTask, listCategories, type TaskRow } from '@/lib/queries/tasks';
import { listSpaces, listSpaceMembers, previewMove } from '@/lib/queries/spaces';
import { deleteTask, moveTaskToSpace, updateTask } from '@/app/actions';
import { SpaceIndicator, CategoryChip } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { Markdown } from '@/components/Markdown';
import { OfflineEdit } from '@/components/OfflineEdit';
import { smartListsFor } from '@/lib/smartlists';
import { SMART_LISTS, isSmartListKey } from '@/lib/queries/tasks';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

const STATUSES = [
  ['todo', 'To do'],
  ['doing', 'Doing'],
  ['blocked', 'Blocked'],
  ['done', 'Done'],
  ['dropped', 'Dropped'],
] as const;

const PRIORITIES = [
  ['none', 'None'],
  ['low', 'Low'],
  ['normal', 'Normal'],
  ['high', 'High'],
  ['urgent', 'Urgent'],
] as const;

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ moveTo?: string }>;
}) {
  const { id } = await params;
  const { moveTo } = await searchParams;

  const user = await requireUser();
  const [task, spaces] = await Promise.all([getTask(user.id, id), listSpaces(user.id)]);
  if (!task) notFound();

  const [categories, members] = await Promise.all([
    listCategories(user.id, task.space.id),
    listSpaceMembers(user.id, task.space.id),
  ]);

  const targets = spaces.filter((s) => s.canWrite && s.id !== task.space.id);

  // The preview is fetched for the space the user is considering, before any
  // write happens. This is the requirement: no move is confirmed without it.
  const target = targets.find((s) => s.id === moveTo);
  const preview = target ? await previewMove(user.id, 'task', task.id, target.id) : null;

  const lists = smartListsFor({
    status: task.status as never,
    dueOn: task.dueOn,
    deferredUntil: task.deferredUntil,
    completedAt: task.completedAt,
  });

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col">
      <header className="hairline border-b px-5 py-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Link href="/tasks/all" className="faint text-[12px]">
            Tasks
          </Link>
          <span className="faint text-[12px]" aria-hidden="true">
            /
          </span>
          <SpaceIndicator space={task.space} />
          <CategoryChip category={task.category} />
        </div>
        <h1 className="text-[17px] font-semibold">
          {task.isLocked ? <em className="muted">Locked task</em> : task.title}
        </h1>
        {lists.length > 0 && (
          <p className="faint mt-1.5 text-[11px]">
            Appears in{' '}
            {lists
              .filter(isSmartListKey)
              .map((k) => SMART_LISTS[k].label)
              .join(', ')}
          </p>
        )}
      </header>

      {task.isLocked ? (
        <div className="muted flex items-center gap-2 px-5 py-10 text-[13px]">
          <Icon name="lock" size={14} />
          This task is locked. It is end-to-end encrypted and can only be opened on a
          device holding the key — the server has never seen its contents, so there is
          nothing here to edit.
        </div>
      ) : (
        <EditForm task={task} categories={categories} members={members} />
      )}

      <section className="hairline border-t px-5 py-4">
        <h2 className="faint mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
          <Icon name="move" size={11} />
          Move to another space
        </h2>

        {targets.length === 0 ? (
          <p className="faint text-[12px]">There is nowhere else to move this.</p>
        ) : !target ? (
          <>
            <p className="muted mb-2 text-[12px]">
              Pick a destination. You will see exactly who gains and loses access before
              anything changes.
            </p>
            <ul className="flex flex-wrap gap-2">
              {targets.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/tasks/item/${task.id}?moveTo=${s.id}` as never}
                    className="surface row-hover flex items-center gap-2 rounded px-2 py-1.5"
                    aria-label={`Preview moving this task to ${s.name}`}
                  >
                    <SpaceIndicator space={s} />
                    <Icon name="arrow_right" size={11} className="faint" />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <MoveConfirmation task={task} target={target} preview={preview ?? []} />
        )}
      </section>

      {!task.isLocked && (
        <OfflineEdit
          entityKind="task"
          entityId={task.id}
          space={task.space}
          updatedAt={task.updatedAt}
          label={task.title}
          fields={[
            { name: 'title', value: task.title },
            { name: 'status', value: task.status, options: STATUSES },
            { name: 'priority', value: task.priority, options: PRIORITIES },
            { name: 'waiting_on', value: task.waitingOn ?? '' },
          ]}
        />
      )}

      <section className="hairline border-t px-5 py-4">
        <h2 className="faint mb-2 text-[10px] font-semibold uppercase tracking-wider">
          Delete
        </h2>
        <form action={deleteTask} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="taskId" value={task.id} />
          <button
            type="submit"
            className="hairline rounded border px-3 py-1.5 text-[12px] font-medium"
            style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
          >
            Delete this task
          </button>
          <span className="faint text-[12px]">
            Permanent, and it takes any sub-tasks and checklist with it.
          </span>
        </form>
      </section>
    </div>
  );
}

function EditForm({
  task,
  categories,
  members,
}: {
  task: TaskRow;
  categories: { id: string; name: string }[];
  members: { id: string; displayName: string }[];
}) {
  return (
    <form action={updateTask} className="flex flex-col gap-4 px-5 py-4">
      <input type="hidden" name="taskId" value={task.id} />

      <Field label="Title" id="task-title">
        <input
          id="task-title"
          name="title"
          defaultValue={task.title}
          required
          autoComplete="off"
          className="input"
        />
      </Field>

      <Field label="Notes" id="task-body" hint="Markdown">
        <textarea
          id="task-body"
          name="bodyMd"
          defaultValue={task.bodyMd}
          rows={5}
          className="input resize-y font-mono text-[12.5px]"
        />
      </Field>

      <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
        <Field label="Status" id="task-status">
          <select id="task-status" name="status" defaultValue={task.status} className="input">
            {STATUSES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>

        <Field label="Priority" id="task-priority">
          <select id="task-priority" name="priority" defaultValue={task.priority} className="input">
            {PRIORITIES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>

        <Field label="Due" id="task-due" hint="DD/MM/YYYY">
          <input
            id="task-due"
            type="date"
            name="dueOn"
            defaultValue={task.dueOn ?? ''}
            className="input"
          />
        </Field>

        <Field label="Category" id="task-category">
          <select
            id="task-category"
            name="categoryId"
            defaultValue={task.categoryId ?? ''}
            className="input"
          >
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Assigned to" id="task-assignee">
          <select
            id="task-assignee"
            name="assigneeId"
            defaultValue={task.assigneeId ?? ''}
            className="input"
          >
            <option value="">Nobody</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.displayName}</option>
            ))}
          </select>
        </Field>

        <Field label="Estimate" id="task-estimate" hint="minutes">
          <input
            id="task-estimate"
            type="number"
            min={1}
            step={1}
            name="estimateMinutes"
            defaultValue={task.estimateMinutes ?? ''}
            className="input"
          />
        </Field>

        <Field label="Waiting on" id="task-waiting" hint="who or what">
          <input
            id="task-waiting"
            name="waitingOn"
            defaultValue={task.waitingOn ?? ''}
            autoComplete="off"
            className="input"
          />
        </Field>

        <Field label="Deferred until" id="task-deferred" hint="hides it in Someday">
          <input
            id="task-deferred"
            type="date"
            name="deferredUntil"
            defaultValue={task.deferredUntil ? task.deferredUntil.slice(0, 10) : ''}
            className="input"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="rounded px-3 py-1.5 text-[12px] font-medium"
          style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
        >
          Save changes
        </button>
        {task.completedAt && (
          <span className="faint text-[11px]">
            Completed {formatDate(task.completedAt.slice(0, 10))}
          </span>
        )}
      </div>

      {task.bodyMd.trim() !== '' && (
        <details className="hairline rounded border p-3">
          <summary className="faint cursor-pointer text-[11px] font-medium uppercase tracking-wider">
            Preview
          </summary>
          <div className="mt-2">
            <Markdown source={task.bodyMd} />
          </div>
        </details>
      )}
    </form>
  );
}

function Field({
  label,
  id,
  hint,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="faint text-[11px] font-medium">
        {label}
        {hint && <span className="ml-1 font-normal opacity-70">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

function MoveConfirmation({
  task,
  target,
  preview,
}: {
  task: TaskRow;
  target: { id: string; name: string; shortLabel: string; colour: string; icon: string };
  preview: { change: string; displayName: string; reason: string }[];
}) {
  const gains = preview.filter((p) => p.change === 'gains');
  const loses = preview.filter((p) => p.change === 'loses');
  const keeps = preview.filter((p) => p.change === 'keeps');

  return (
    <div className="surface rounded-md p-4">
      <div className="mb-3 flex items-center gap-2 text-[13px]">
        <SpaceIndicator space={task.space} size="md" />
        <Icon name="arrow_right" size={13} className="faint" />
        <SpaceIndicator space={target} size="md" />
      </div>

      <div className="flex flex-col gap-2 text-[12px]">
        {loses.length > 0 && (
          <Group
            tone="var(--danger)"
            heading={`${loses.length === 1 ? 'This person loses' : 'These people lose'} access`}
            people={loses}
          />
        )}
        {gains.length > 0 && (
          <Group
            tone="var(--accent)"
            heading={`${gains.length === 1 ? 'This person gains' : 'These people gain'} access`}
            people={gains}
          />
        )}
        {keeps.length > 0 && (
          <Group tone="var(--text-muted)" heading="Unchanged" people={keeps} />
        )}
        {preview.length === 0 && <p className="faint">Nobody’s access changes.</p>}
      </div>

      {/* Categories belong to a space, so the current one cannot follow the
          task across. Saying so here is the difference between a consequence
          and a surprise. */}
      {task.category && (
        <p className="muted mt-3 flex items-start gap-1.5 text-[12px]">
          <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
          <span>
            The category <strong className="font-medium">{task.category.name}</strong> belongs
            to {task.space.name} and will be cleared. Pick a {target.name} category afterwards
            if you want one.
          </span>
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <form action={moveTaskToSpace}>
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="targetSpaceId" value={target.id} />
          <button
            type="submit"
            className="rounded px-3 py-1.5 text-[12px] font-medium"
            style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
          >
            Move to {target.name}
          </button>
        </form>
        <Link href={`/tasks/item/${task.id}` as never} className="muted text-[12px]">
          Cancel
        </Link>
      </div>
    </div>
  );
}

function Group({
  tone,
  heading,
  people,
}: {
  tone: string;
  heading: string;
  people: { displayName: string; reason: string }[];
}) {
  return (
    <div>
      <h3 className="font-medium" style={{ color: tone }}>
        {heading}
      </h3>
      <ul className="muted mt-0.5 flex flex-col gap-0.5">
        {people.map((p) => (
          <li key={p.displayName}>
            {p.displayName} <span className="faint">— {p.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
