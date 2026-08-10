import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listSpaces } from '@/lib/queries/spaces';
import { listPeople } from '@/lib/queries/people';
import { categoriesBySpace } from '@/lib/queries/tasks';
import { ComposePerson } from '@/components/ComposePerson';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { SearchButton } from '@/components/SearchButton';
import { PeopleList, personDetail } from '@/components/people/PeopleList';
import { PeopleMap, type PlacelessPerson } from '@/components/people/PeopleMap';
import type { MapPerson } from '@/components/people/types';
import { plural } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * People, in two views.
 *
 * The view is in the URL (`?view=map`) rather than in client state, for the
 * reasons every other switch in this app is: it survives a reload, it can be
 * sent to somebody, and the back button undoes it. List is the default, and it
 * is the default deliberately — a map is the answer to one question ("who is
 * near what") and the list is the answer to all the others, so the map is the
 * thing you ask for.
 *
 * The two views are the same query. Nothing is filtered out for the map; the
 * people it cannot draw are counted in the header and listed in the sheet.
 */
export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ space?: string; q?: string; view?: string }>;
}) {
  const { space: spaceId, q, view: rawView } = await searchParams;
  const view = rawView === 'map' ? 'map' : 'list';

  const user = await requireUser();
  const [spaces, categories, people] = await Promise.all([
    listSpaces(user.id),
    categoriesBySpace(user.id),
    listPeople(user.id, { spaceId: spaceId ?? null, query: q ?? '' }),
  ]);

  const activeSpace = spaces.find((s) => s.id === spaceId);
  // How many spaces these people actually come from — which is the number the
  // subtitle is about. Not `spaces.length`: a space you are in but have nobody
  // in is not a space this list spans.
  const spaceCount = new Set(people.map((p) => p.space.id)).size;

  // A place without coordinates is a real place — typed in and never geocoded
  // — so "has a place" and "can be drawn" are two different questions, and the
  // map only gets to answer the second. Somebody with an address and no pin
  // belongs in the placeless list, because that is where they can be found.
  const mappable: MapPerson[] = people
    .filter((p) => !p.isLocked && p.homeLat != null && p.homeLon != null)
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      category: p.category,
      space: p.space,
      detail: personDetail(p),
      placeName: p.homePlaceName ?? 'a place',
      placeAddress: p.homePlaceAddress,
      lat: p.homeLat!,
      lon: p.homeLon!,
    }));

  const mappableIds = new Set(mappable.map((p) => p.id));
  const placeless: PlacelessPerson[] = people
    .filter((p) => !mappableIds.has(p.id))
    .map((p) => ({
      id: p.id,
      displayName: p.isLocked ? 'Locked person' : p.displayName,
      colour: p.category?.colour ?? null,
      spaceName: p.space.name,
    }));

  return (
    // The map view is a *bounded* box, not a scrolling page: the map fills
    // what is left under the header and the sheet is positioned against the
    // bottom of it. The height has to subtract `--tabbar` — `h-screen` is
    // 100vh, which is taller than the room `<main>`'s bottom padding leaves,
    // so the sheet ended up underneath the tab bar with only its grab handle
    // showing. Zero from `md` up, where there is no bar. The list view is an
    // ordinary scrolling page and keeps `min-h-screen`.
    <div
      className={`flex flex-col ${view === 'map' ? '' : 'min-h-screen'}`}
      style={view === 'map' ? { height: 'calc(100svh - var(--tabbar))' } : undefined}
    >
      <header className="hairline shrink-0 border-b px-5 pb-3.5 pt-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-[-0.02em] md:text-lg md:tracking-normal">
                People
              </h1>
              {activeSpace && <SpaceIndicator space={activeSpace} size="md" />}
            </div>
            <p className="muted mt-1 text-sm md:mt-0.5 md:text-xs">
              {view === 'map'
                ? // The mappable fraction, in the header, before anybody counts
                  // the pins and wonders. Migration 0017 on why null is ordinary.
                  `${mappable.length} of ${people.length} have a place`
                : `${plural(people.length, 'person', 'people')} across ${plural(spaceCount, 'space')}`}
            </p>
          </div>
          <SearchButton kind="person" label="Search people" />
        </div>

        <div className="mt-3">
          <ViewSwitch view={view} spaceId={spaceId} q={q} />
        </div>
      </header>

      {view === 'map' ? (
        <PeopleMap mappable={mappable} placeless={placeless} />
      ) : (
        <>
          {/* Kept at every width, unlike the compose bars on Home and Tasks:
              the capture button creates a task, a note or an event, so this is
              the only way to add a person on a phone. The design's People
              screen does not show it; dropping it would have removed the
              capability rather than moved it. */}
          <ComposePerson spaces={spaces} categories={categories} defaultSpaceId={spaceId} />

          {/* GET, not a server action: a search you can bookmark and go back
              to. Desktop only — on a phone the header's search button is what
              replaced it, and it reaches every kind rather than just people. */}
          <form
            method="get"
            className="hairline hidden flex-wrap items-center gap-2 border-b px-3 py-2 md:flex"
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
              className="min-w-40 flex-1 bg-transparent text-sm outline-none placeholder:text-[color:var(--text-faint)]"
            />
            <button type="submit" className="hairline rounded border px-2 py-1 text-xs">
              Search
            </button>
            {q && (
              <Link href="/people" className="faint text-xs">
                Clear
              </Link>
            )}
          </form>

          <p className="faint hidden px-5 pb-2 pt-2.5 text-xs md:block">
            The same person can appear in more than one space. Those records stay
            separate and are linked, never merged.
          </p>

          {people.length === 0 ? (
            <p className="faint px-5 py-10 text-sm">
              {q ? `Nobody matches “${q}”.` : 'No people here.'}
            </p>
          ) : (
            <PeopleList people={people} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * List / Map, as two links.
 *
 * Links rather than buttons, so no client JavaScript is needed to change view
 * and the URL is the state — the same arrangement `RangeSwitch` and the
 * calendar's Day/Week/Month use. The space filter and the query ride along, so
 * switching view does not silently widen what you are looking at.
 */
function ViewSwitch({
  view,
  spaceId,
  q,
}: {
  view: 'list' | 'map';
  spaceId?: string;
  q?: string;
}) {
  const carry = (v: 'list' | 'map') => {
    const p = new URLSearchParams();
    if (spaceId) p.set('space', spaceId);
    if (q) p.set('q', q);
    if (v === 'map') p.set('view', 'map');
    const qs = p.toString();
    return `/people${qs ? `?${qs}` : ''}`;
  };

  return (
    <nav className="seg flex-none whitespace-nowrap" aria-label="People view">
      <Link href={carry('list') as never} aria-current={view === 'list' ? 'page' : undefined}>
        List
      </Link>
      <Link href={carry('map') as never} aria-current={view === 'map' ? 'page' : undefined}>
        Map
      </Link>
    </nav>
  );
}
