import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { getTravelSession, listLegsInSession } from '@/lib/queries/travel';
import { listPlacesForPicker } from '@/lib/queries/places';
import { deleteTravelSession, updateTravelSession } from '@/app/actions';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { Markdown } from '@/components/Markdown';
import {
  formatDate,
  formatDuration,
  formatTime,
  londonDayISO,
  plural,
} from '@/lib/format';
import {
  LEG_MODES,
  LEG_MODE_ICON,
  LEG_MODE_LABEL,
  tripStanding,
} from '@/lib/travel';

export const dynamic = 'force-dynamic';

/**
 * One trip.
 *
 * Rough edge since Phase 4: a trip could be created and deleted and nothing in
 * between. Its dates, its name and its notes were fixed at the moment it was
 * made, so a date typed wrong meant deleting the trip — and the FK cascades, so
 * that took every journey attached to it as well.
 *
 * Where the trip stands is derived from its dates on every render, never read
 * from `travel_sessions.is_active`. That column is written from the dates at
 * every write, including this page's, but nothing sweeps it and Orbit has no
 * scheduler by decision, so a stored "away" is stale the moment the trip ends. A
 * date range cannot go stale. The page says which of the two it is showing,
 * because a page that quietly disagrees with a column is worse than one that
 * explains itself.
 *
 * Decision 5 is still in force here, and the page says so: nothing on it reads a
 * device's position and Orbit never asks for the permission.
 */
export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const user = await requireUser();

  // Not found and not permitted are the same answer, as everywhere else: a 403
  // would confirm the trip exists.
  const trip = await getTravelSession(user.id, id);
  if (!trip) notFound();

  const [legs, places] = await Promise.all([
    listLegsInSession(user.id, trip.id),
    listPlacesForPicker(user.id),
  ]);

  const standing = tripStanding(trip);
  // Only places in this trip's own space can be its endpoints. The list is
  // already filtered by policy — this narrows it to the space, which is a
  // different question: a place you *can* see in another space would still be a
  // place your partner cannot, on a trip they can.
  const inSpace = places.filter((p) => p.space.id === trip.space.id);

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col">
      <header className="hairline border-b px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/travel" className="faint text-xs underline-offset-2 hover:underline">
            Travel
          </Link>
          <span className="faint text-xs" aria-hidden="true">
            /
          </span>
          <SpaceIndicator space={trip.space} />
          <span
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-medium"
            style={
              standing.phase === 'running'
                ? { color: 'var(--accent)', background: 'var(--bg-raised)' }
                : { color: 'var(--text-faint)', background: 'var(--bg-sunken)' }
            }
          >
            <Icon name="suitcase" size={11} />
            {standing.phase === 'running'
              ? 'Away now'
              : standing.phase === 'upcoming'
                ? standing.daysAway === 0
                  ? 'Starts today'
                  : `In ${plural(standing.daysAway, 'day')}`
                : standing.daysAway === 0
                  ? 'Ended today'
                  : `${plural(standing.daysAway, 'day')} ago`}
          </span>
          <span className="faint inline-flex items-center gap-1 text-2xs">
            <Icon name={trip.source === 'calendar' ? 'calendar' : 'pin'} size={11} />
            {trip.source === 'calendar' ? 'lifted from a calendar event' : 'entered by hand'}
          </span>
        </div>
        <h1 className="mt-1 text-lg font-semibold">{trip.title}</h1>
        <p className="muted mt-0.5 text-xs">
          {formatDate(trip.startsAt)} – {formatDate(trip.endsAt)} ·{' '}
          {plural(standing.days, 'day')} · {plural(trip.legCount, 'journey')}
        </p>
        <p className="faint mt-0.5 text-2xs">
          Whether you are away is worked out from these dates every time this page
          is drawn, not stored. Orbit does not know where you are: there is no
          background location and the permission is never requested.
        </p>
      </header>

      {/* One live region for everything the page says back, as on the rule page. */}
      <div aria-live="polite" className="empty:hidden">
        {error && (
          <p
            role="alert"
            className="hairline border-b px-5 py-2 text-xs"
            style={{ background: 'var(--c-amber-bg)', color: 'var(--c-amber)' }}
          >
            {error}
          </p>
        )}
        {!error && saved && (
          <p className="hairline muted border-b px-5 py-2 text-xs">
            Saved. Its journeys are unchanged — editing a trip’s dates does not
            move the journeys inside it.
          </p>
        )}
      </div>

      <form action={updateTravelSession} className="flex flex-col gap-3 px-5 py-4">
        <input type="hidden" name="sessionId" value={trip.id} />

        <label htmlFor="trip-title" className="sr-only">
          Trip name
        </label>
        <input
          id="trip-title"
          name="title"
          defaultValue={trip.title}
          required
          className="bg-transparent text-xl font-semibold outline-none"
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First day" htmlFor="trip-start">
            <input
              id="trip-start"
              type="date"
              name="startDate"
              defaultValue={londonDayISO(trip.startsAt)}
              required
              className="input"
            />
          </Field>
          <Field label="Last day" htmlFor="trip-end">
            <input
              id="trip-end"
              type="date"
              name="endDate"
              defaultValue={londonDayISO(trip.endsAt)}
              required
              className="input"
            />
          </Field>
          <Field label="Setting out from" htmlFor="trip-origin">
            <select
              id="trip-origin"
              name="originPlaceId"
              defaultValue={trip.originPlaceId ?? ''}
              className="input"
            >
              <option value="">Not recorded</option>
              {inSpace.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Going to" htmlFor="trip-destination">
            <select
              id="trip-destination"
              name="destinationPlaceId"
              defaultValue={trip.destinationPlaceId ?? ''}
              className="input"
            >
              <option value="">Not recorded</option>
              {inSpace.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Notes (Markdown)" htmlFor="trip-notes">
          <textarea
            id="trip-notes"
            name="notesMd"
            defaultValue={trip.notesMd}
            rows={6}
            className="input resize-y font-mono text-xs leading-relaxed"
          />
        </Field>

        <div>
          <button
            type="submit"
            className="rounded px-3 py-1.5 text-xs font-medium"
            style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
          >
            Save changes
          </button>
        </div>
      </form>

      {trip.notesMd.trim() !== '' && (
        <section className="hairline border-t px-5 py-4">
          <h2 className="faint mb-2 text-2xs font-semibold uppercase tracking-wider">
            Rendered
          </h2>
          <Markdown source={trip.notesMd} />
        </section>
      )}

      <section className="hairline border-t px-5 py-4">
        <h2 className="faint mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider">
          <Icon name="route" size={11} />
          Journeys on this trip
        </h2>
        {legs.length === 0 ? (
          <p className="muted text-xs">
            None attached yet. Journeys are recorded against a day on{' '}
            <Link href="/travel" className="underline underline-offset-2">
              Travel
            </Link>
            , where a trip can be picked as the one they belong to.
          </p>
        ) : (
          <ul className="flex flex-col" aria-label="Journeys on this trip">
            {legs.map((leg) => {
              const mode = (LEG_MODES as readonly string[]).includes(leg.mode) ? leg.mode : 'other';
              return (
                <li
                  key={leg.id}
                  className="hairline row-hover flex flex-wrap items-baseline gap-2 border-b py-1.5"
                >
                  <Icon name={LEG_MODE_ICON[mode]} size={12} className="faint shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {leg.fromPlaceName ?? 'Somewhere else'}
                    <span className="faint mx-1.5" aria-hidden="true">
                      →
                    </span>
                    {leg.toPlaceName ?? 'Somewhere else'}
                  </span>
                  {leg.departAt && (
                    <Link
                      href={`/travel?day=${londonDayISO(leg.departAt)}`}
                      className="text-xs tabular-nums underline-offset-2 hover:underline"
                    >
                      {formatDate(leg.departAt)} {formatTime(leg.departAt)}
                    </Link>
                  )}
                  {leg.durationMinutes != null && (
                    <span className="faint text-2xs">{formatDuration(leg.durationMinutes)}</span>
                  )}
                  <span className="faint text-2xs">{LEG_MODE_LABEL[mode]}</span>
                  <SpaceIndicator space={leg.space} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="hairline border-t px-5 py-4">
        <h2 className="faint mb-2 text-2xs font-semibold uppercase tracking-wider">Delete</h2>
        <p className="muted mb-2 text-xs">
          Deleting this trip deletes {trip.legCount === 0 ? 'it' : plural(trip.legCount, 'journey')}{' '}
          {trip.legCount === 0 ? 'only' : 'attached to it'} — a journey with no trip is not a
          journey anybody asked for. Dates typed wrong can be corrected above instead.
        </p>
        <form action={deleteTravelSession}>
          <input type="hidden" name="sessionId" value={trip.id} />
          <input type="hidden" name="then" value="travel" />
          <button
            type="submit"
            className="hairline rounded border px-3 py-1.5 text-xs"
            style={{ color: 'var(--danger)' }}
          >
            Delete this trip
          </button>
        </form>
      </section>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="faint text-2xs">
        {label}
      </label>
      {children}
    </div>
  );
}
