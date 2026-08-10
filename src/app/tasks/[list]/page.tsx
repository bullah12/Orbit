import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { listSpaces } from '@/lib/queries/spaces';
import {
  assignableBySpace,
  categoriesBySpace,
  listTasks,
  smartListCounts,
  SMART_LISTS,
  isSmartListKey,
} from '@/lib/queries/tasks';
import { TaskListTabs } from '@/components/TaskListTabs';
import { SearchButton } from '@/components/SearchButton';
import { TaskRow } from '@/components/TaskRow';
import { ComposeTask } from '@/components/ComposeTask';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { plural } from '@/lib/format';
import { resolveDefaultSpace } from '@/lib/prefs';
import { readDefaultSpaceRaw } from '@/lib/prefs/cookies';

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
  const [spaces, categories, tasks, assignable, preferredSpaceRaw, counts] = await Promise.all([
    listSpaces(user.id),
    categoriesBySpace(user.id),
    listTasks(user.id, list, { spaceId: spaceId ?? null }),
    assignableBySpace(user.id),
    readDefaultSpaceRaw(),
    // The segment counts. Same query the rail's counts come from, scoped to
    // the same space, so the two cannot disagree by two inches.
    smartListCounts(user.id, spaceId ?? null),
  ]);

  // Standing in a space wins over the preference: `?space=` means somebody
  // opened that space's own list, and a new task there belongs there. The
  // preference is the fallback for the nine smart lists, which span spaces and
  // so have nothing better to offer than "the first writable one".
  //
  // Re-validated on every read against the spaces this caller can *write*, so a
  // cookie naming a space they have since left falls back rather than failing.
  const preferredSpace = resolveDefaultSpace(
    preferredSpaceRaw,
    spaces.filter((s) => s.canWrite).map((s) => s.id),
  );

  const meta = SMART_LISTS[list];
  const activeSpace = spaces.find((s) => s.id === spaceId);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="hairline border-b px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold">{meta.label}</h1>
          {activeSpace && <SpaceIndicator space={activeSpace} size="md" />}
          <span className="faint text-xs">{plural(tasks.length, 'task')}</span>
          <span className="ml-auto">
            <SearchButton kind="task" label="Search tasks" />
          </span>
        </div>
        {/* The active list's own sentence, under the title. It was already
            here; the segments above make it carry more, because the label in
            a scrolling row of nine is the shortest a list is ever named. */}
        <p className="muted mt-0.5 text-xs">{meta.blurb}</p>
      </header>

      <TaskListTabs active={list} counts={counts} spaceId={spaceId ?? null} />

      <ComposeTask
        spaces={spaces}
        categories={categories}
        defaultSpaceId={spaceId ?? preferredSpace ?? undefined}
      />

      {tasks.length === 0 ? (
        <p className="faint px-5 py-10 text-sm">Nothing here.</p>
      ) : (
        <ul>
          {tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              showAssignee={list !== 'mine'}
              assignable={assignable[t.space.id]}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
