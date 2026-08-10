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
      {/* "Tasks", not the list's name. The nine lists are one page now and the
          segmented row below says which of them you are on — putting the same
          word in the heading and in the selected segment two lines apart is
          the title saying nothing. The blurb underneath is the active list's
          own sentence, which is the part that does carry information. */}
      <header className="flex items-start gap-2 px-5 pb-3 pt-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-[-0.02em] md:text-lg md:tracking-normal">
              Tasks
            </h1>
            {activeSpace && <SpaceIndicator space={activeSpace} size="md" />}
            <span className="faint text-xs">{plural(tasks.length, 'task')}</span>
          </div>
          <p className="muted mt-1 text-sm md:mt-0.5 md:text-xs">{meta.blurb}</p>
        </div>
        <SearchButton kind="task" label="Search tasks" />
      </header>

      <TaskListTabs active={list} counts={counts} spaceId={spaceId ?? null} />

      {/* Desktop only, as on Home: the FAB is the phone's way in. */}
      <div className="hidden md:block">
        <ComposeTask
          spaces={spaces}
          categories={categories}
          defaultSpaceId={spaceId ?? preferredSpace ?? undefined}
        />
      </div>

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
