import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { getTask } from '@/lib/queries/tasks';
import { listSpaces, previewMove } from '@/lib/queries/spaces';
import { moveTaskToSpace } from '@/app/actions';
import { SpaceIndicator, CategoryChip } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { formatDueDate, formatDuration } from '@/lib/format';

export const dynamic = 'force-dynamic';

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

  const targets = spaces.filter((s) => s.canWrite && s.id !== task.space.id);

  // The preview is fetched for the space the user is considering, before any
  // write happens. This is the requirement: no move is confirmed without it.
  const target = targets.find((s) => s.id === moveTo);
  const preview = target ? await previewMove(user.id, 'task', task.id, target.id) : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col">
      <header className="hairline border-b px-5 py-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Link href="/tasks/all" className="faint text-[12px]">
            Tasks
          </Link>
          <span className="faint text-[12px]">/</span>
          <SpaceIndicator space={task.space} />
          <CategoryChip category={task.category} />
        </div>
        <h1 className="text-[17px] font-semibold">
          {task.isLocked ? <em className="muted">Locked task</em> : task.title}
        </h1>
        <dl className="muted mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
          <Field label="Status" value={task.status} />
          <Field label="Priority" value={task.priority} />
          {task.dueOn && <Field label="Due" value={formatDueDate(task.dueOn)} />}
          {task.assigneeName && <Field label="Assigned to" value={task.assigneeName} />}
          {task.waitingOn && <Field label="Waiting on" value={task.waitingOn} />}
          {task.estimateMinutes != null && (
            <Field label="Estimate" value={formatDuration(task.estimateMinutes)} />
          )}
        </dl>
      </header>

      {!task.isLocked && task.bodyMd && (
        <div className="hairline whitespace-pre-wrap border-b px-5 py-4 text-[13px]">
          {task.bodyMd}
        </div>
      )}

      <section className="px-5 py-4">
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
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="faint">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function MoveConfirmation({
  task,
  target,
  preview,
}: {
  task: { id: string; space: { id: string; name: string; shortLabel: string; colour: string; icon: string } };
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
        {preview.length === 0 && (
          <p className="faint">Nobody’s access changes.</p>
        )}
      </div>

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
