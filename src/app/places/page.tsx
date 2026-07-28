import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listSpaces } from '@/lib/queries/spaces';
import { listPlaces } from '@/lib/queries/places';
import { categoriesBySpace } from '@/lib/queries/tasks';
import { ComposePlace } from '@/components/ComposePlace';
import { SpaceIndicator, CategoryChip } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { plural } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function PlacesPage({
  searchParams,
}: {
  searchParams: Promise<{ space?: string; q?: string; archived?: string }>;
}) {
  const { space: spaceId, q, archived } = await searchParams;
  const showArchived = archived === '1';
  const user = await requireUser();
  const [spaces, categories, places] = await Promise.all([
    listSpaces(user.id),
    categoriesBySpace(user.id),
    listPlaces(user.id, {
      spaceId: spaceId ?? null,
      query: q ?? '',
      includeArchived: showArchived,
    }),
  ]);

  const activeSpace = spaces.find((s) => s.id === spaceId);
  const withoutPoint = places.filter((p) => p.lat === null).length;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="hairline border-b px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-[15px] font-semibold">Places</h1>
          {activeSpace && <SpaceIndicator space={activeSpace} size="md" />}
          <span className="faint text-[12px]">{plural(places.length, 'place')}</span>
          {withoutPoint > 0 && (
            <span className="faint text-[12px]">
              {withoutPoint} without coordinates
            </span>
          )}
        </div>
        <p className="muted mt-0.5 text-[12px]">
          Somewhere you go. A place belongs to one space, and moving it between
          spaces changes who can see it — you will be shown exactly who first.
        </p>
      </header>

      <ComposePlace spaces={spaces} categories={categories} defaultSpaceId={spaceId} />

      {/* GET, not a server action: a search you can bookmark and go back to. */}
      <form
        method="get"
        className="hairline flex flex-wrap items-center gap-2 border-b px-3 py-2"
        style={{ background: 'var(--bg-raised)' }}
      >
        {spaceId && <input type="hidden" name="space" value={spaceId} />}
        {showArchived && <input type="hidden" name="archived" value="1" />}
        <label htmlFor="places-q" className="sr-only">
          Search places by name, address or postcode
        </label>
        <Icon name="map_pin" size={14} className="faint" />
        <input
          id="places-q"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search by name, address or postcode…"
          autoComplete="off"
          className="min-w-40 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[color:var(--text-faint)]"
        />
        <button type="submit" className="hairline rounded border px-2 py-1 text-[12px]">
          Search
        </button>
        {q && (
          <Link href="/places" className="faint text-[12px]">
            Clear
          </Link>
        )}
        <Link
          href={showArchived ? '/places' : '/places?archived=1'}
          className="faint ml-auto text-[12px]"
        >
          {showArchived ? 'Hide archived' : 'Show archived'}
        </Link>
      </form>

      {places.length === 0 ? (
        <p className="faint px-5 py-10 text-[13px]">
          {q ? `Nothing matches “${q}”.` : 'No places here yet.'}
        </p>
      ) : (
        <ul>
          {places.map((p) => (
            <li key={p.id} className="hairline row-hover border-b px-3 py-2">
              <Link href={`/places/${p.id}` as never} className="block">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {p.isLocked ? <em className="muted">Locked place</em> : p.name}
                    {p.archivedAt && (
                      <span className="faint ml-1.5 text-[11px]">archived</span>
                    )}
                  </span>
                  {p.postcode && !p.isLocked && (
                    <span className="faint shrink-0 font-mono text-[11px]">{p.postcode}</span>
                  )}
                  {p.lat === null ? (
                    <span
                      className="faint inline-flex shrink-0 items-center gap-1 text-[11px]"
                      title="No coordinates yet"
                    >
                      <Icon name="alert" size={10} />
                      no point
                    </span>
                  ) : (
                    <span
                      className="faint inline-flex shrink-0 items-center gap-1 text-[11px]"
                      title={`${p.lat.toFixed(4)}, ${p.lon!.toFixed(4)} — from ${p.geocodeSource ?? 'manual'}`}
                    >
                      <Icon name="map_pin" size={10} />
                      {p.lat.toFixed(3)}, {p.lon!.toFixed(3)}
                    </span>
                  )}
                  {p.eventCount > 0 && (
                    <span className="faint inline-flex shrink-0 items-center gap-1 text-[11px]">
                      <Icon name="calendar" size={10} />
                      {p.eventCount}
                    </span>
                  )}
                  {p.visitCount > 0 && (
                    <span className="faint inline-flex shrink-0 items-center gap-1 text-[11px]">
                      <Icon name="check" size={10} />
                      {plural(p.visitCount, 'visit')}
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
