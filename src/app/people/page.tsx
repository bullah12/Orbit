import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listSpaces } from '@/lib/queries/spaces';
import { listPeople } from '@/lib/queries/people';
import { categoriesBySpace } from '@/lib/queries/tasks';
import { ComposePerson } from '@/components/ComposePerson';
import { SpaceIndicator, CategoryChip } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { formatDueDate, plural } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ space?: string; q?: string }>;
}) {
  const { space: spaceId, q } = await searchParams;
  const user = await requireUser();
  const [spaces, categories, people] = await Promise.all([
    listSpaces(user.id),
    categoriesBySpace(user.id),
    listPeople(user.id, { spaceId: spaceId ?? null, query: q ?? '' }),
  ]);

  const activeSpace = spaces.find((s) => s.id === spaceId);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="hairline border-b px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-[15px] font-semibold">People</h1>
          {activeSpace && <SpaceIndicator space={activeSpace} size="md" />}
          <span className="faint text-[12px]">{plural(people.length, 'person', 'people')}</span>
        </div>
        <p className="muted mt-0.5 text-[12px]">
          The same person can appear in more than one space. Those records stay separate
          and are linked, never merged.
        </p>
      </header>

      <ComposePerson spaces={spaces} categories={categories} defaultSpaceId={spaceId} />

      {/* GET, not a server action: a search you can bookmark and go back to. */}
      <form
        method="get"
        className="hairline flex flex-wrap items-center gap-2 border-b px-3 py-2"
        style={{ background: 'var(--bg-raised)' }}
      >
        {spaceId && <input type="hidden" name="space" value={spaceId} />}
        <label htmlFor="people-q" className="sr-only">
          Search people by name or nickname
        </label>
        <Icon name="users" size={14} className="faint" />
        <input
          id="people-q"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search by name or nickname…"
          autoComplete="off"
          className="min-w-40 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[color:var(--text-faint)]"
        />
        <button type="submit" className="hairline rounded border px-2 py-1 text-[12px]">
          Search
        </button>
        {q && (
          <Link href="/people" className="faint text-[12px]">
            Clear
          </Link>
        )}
      </form>

      {people.length === 0 ? (
        <p className="faint px-5 py-10 text-[13px]">
          {q ? `Nobody matches “${q}”.` : 'No people here.'}
        </p>
      ) : (
        <ul>
          {people.map((p) => (
            <li key={p.id} className="hairline row-hover border-b px-3 py-2">
              <Link href={`/people/${p.id}` as never} className="block">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {p.isLocked ? <em className="muted">Locked person</em> : p.displayName}
                    {p.nickname && !p.isLocked && (
                      <span className="faint ml-1.5 text-[11px]">“{p.nickname}”</span>
                    )}
                  </span>
                  {p.linkCount > 0 && (
                    <span
                      className="faint inline-flex shrink-0 items-center gap-1 text-[11px]"
                      title="Also has a record in another space"
                    >
                      <Icon name="link" size={10} />
                      linked
                    </span>
                  )}
                  {p.nextDate && (
                    <span className="faint inline-flex shrink-0 items-center gap-1 text-[11px]">
                      <Icon name="cake" size={10} />
                      {formatDueDate(nextOccurrence(p.nextDate.onDate))}
                    </span>
                  )}
                  <CategoryChip category={p.category} />
                  <SpaceIndicator space={p.space} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The next time this day-of-year comes round, as an ISO date. */
function nextOccurrence(onDate: string): string {
  const today = new Date();
  const [, m, d] = onDate.slice(0, 10).split('-');
  const year = today.getUTCFullYear();
  const thisYear = `${year}-${m}-${d}`;
  const todayIso = today.toISOString().slice(0, 10);
  return thisYear >= todayIso ? thisYear : `${year + 1}-${m}-${d}`;
}
