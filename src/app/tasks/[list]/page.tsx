import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { listSpaces } from '@/lib/queries/spaces';
import { listTasks, SMART_LISTS, isSmartListKey } from '@/lib/queries/tasks';
import { TaskRow } from '@/components/TaskRow';
import { ComposeTask } from '@/components/ComposeTask';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { plural } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function TaskListPage({
  params,
  searchParams,
}: {
  params: Promise<{ list: string }>;
  searchParams: Promise<{ space?: string }>;
}) {
  const { list } = await params;
  const { space: spaceId } = await searchParams;
  if (!isSmartListKey(list)) notFound();

  const user = await requireUser();
  const [spaces, tasks] = await Promise.all([
    listSpaces(user.id),
    listTasks(user.id, list, { spaceId: spaceId ?? null }),
  ]);

  const meta = SMART_LISTS[list];
  const activeSpace = spaces.find((s) => s.id === spaceId);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="hairline border-b px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-[15px] font-semibold">{meta.label}</h1>
          {activeSpace && <SpaceIndicator space={activeSpace} size="md" />}
          <span className="faint text-[12px]">{plural(tasks.length, 'task')}</span>
        </div>
        <p className="muted mt-0.5 text-[12px]">{meta.blurb}</p>
      </header>

      <ComposeTask spaces={spaces} defaultSpaceId={spaceId} />

      {tasks.length === 0 ? (
        <p className="faint px-5 py-10 text-[13px]">Nothing here.</p>
      ) : (
        <ul>
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </ul>
      )}
    </div>
  );
}
