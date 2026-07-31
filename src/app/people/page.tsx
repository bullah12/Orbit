import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listWhereabouts, type Whereabouts } from '@/lib/queries/whereabouts';
import { PeopleMap } from '@/components/PeopleMap';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';

export const dynamic = 'force-dynamic';

/**
 * People — where everyone is.
 *
 * Read-only and one nav step away from Now, on purpose: location is glanceable
 * but rarely actionable, and a map on the landing page would make the first
 * thing this app does every morning a location question.
 *
 * What it shows is *last known*, from check-ins and the calendar. Orbit does
 * not track anyone in the background and never asks for the permission — see
 * decision 5. A person whose position is not readable stays in the list and
 * renders `.locked`; the absence has to read as deliberate rather than as
 * somebody who dropped off the map.
 */
export default async function PeoplePage() {
  const user = await requireUser();
  const people = await listWhereabouts(user.id);

  return (
    <div className="mx-auto w-full max-w-[52rem] px-3 py-4">
      <div className="surface overflow-hidden">
        <header className="hairline flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-2.5 py-2">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold" style={{ letterSpacing: '-0.01em' }}>
              People
            </h1>
            <p className="muted text-xs">Last known, from check-ins and the calendar</p>
          </div>
          <Link
            href="/people/directory"
            className="hairline row-hover ml-auto shrink-0 rounded-md border px-2 py-1 text-sm"
          >
            Directory
          </Link>
        </header>

        <PeopleMap people={people} />

        {people.length === 0 ? (
          <p className="faint px-2.5 py-8 text-sm">
            Nobody shares a space with you yet, so there is nothing to place.
          </p>
        ) : (
          <ul>
            {people.map((p) => (
              <PersonRow key={p.personId} person={p} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PersonRow({ person }: { person: Whereabouts }) {
  return (
    <li className="row row-hover">
      <span
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: `var(--c-${person.space.colour}, var(--c-slate))` }}
        aria-hidden="true"
      />
      <span className="min-w-0 shrink-0 text-sm">{person.name}</span>

      {person.locked ? (
        // Sharing is off. Mono and dashed, because the absence is a decision
        // somebody made and has to read as one — not as a missing row.
        <span className="locked min-w-0 flex-1">Location not shared</span>
      ) : (
        <>
          <span className="muted min-w-0 flex-1 truncate text-xs">
            {person.placeName == null ? (
              <span className="faint">No recent check-in</span>
            ) : (
              <>
                {person.present && (
                  <Icon name="map_pin" size={10} className="mr-1 inline-block align-baseline" />
                )}
                {person.placeName}
              </>
            )}
          </span>
          <span className="faint tabular shrink-0 text-xs">{lastSeen(person)}</span>
        </>
      )}

      <SpaceIndicator space={person.space} />
    </li>
  );
}

/**
 * How long ago, in words a household actually uses. "Now" is reserved for a
 * visit with no departure — somebody who is still there, rather than somebody
 * who arrived a minute ago and left.
 */
function lastSeen(person: Whereabouts): string {
  if (person.lastSeen == null) return '';
  if (person.present) return 'now';

  const mins = Math.round((Date.now() - new Date(person.lastSeen).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}
