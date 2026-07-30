import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listSpaces } from '@/lib/queries/spaces';
import { listPlacesForPicker } from '@/lib/queries/places';
import {
  listLegsOnDay,
  listTravelSessions,
  sessionCandidates,
  travelEventsOnDay,
  type TravelLegRow,
} from '@/lib/queries/travel';
import {
  createSessionFromEvent,
  deleteTravelLeg,
  deleteTravelSession,
  reestimateTravelLeg,
  saveDerivedLeg,
} from '@/app/actions';
import { ComposeTravelLeg } from '@/components/ComposeTravelLeg';
import { ComposeTravelSession } from '@/components/ComposeTravelSession';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import {
  addDaysISO,
  formatDate,
  formatDuration,
  formatTime,
  plural,
  todayISO,
} from '@/lib/format';
import {
  deriveLegs,
  estimateLegMinutes,
  fitsInGap,
  LEG_MODES,
  LEG_MODE_ICON,
  LEG_MODE_LABEL,
  planLeg,
  sessionDayCount,
  sessionFromEvent,
  sessionIsActive,
  type DerivedLeg,
  type LegMode,
} from '@/lib/travel';
import { travelTimeProvider } from '@/lib/integrations';

export const dynamic = 'force-dynamic';

/**
 * Travel.
 *
 * Two halves, and both of them are decision 5 in the flesh. **Trips** are
 * started by hand or lifted from a multi-day event. **Journeys** are typed in
 * or derived from two events at different places. Nothing on this page reads a
 * device's position, and Orbit does not request the permission — there is no
 * code path here that could, which is the point of writing it down.
 */
export default async function TravelPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; from?: string }>;
}) {
  const { day: dayParam, from: fromPlaceId } = await searchParams;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayParam ?? '') ? dayParam! : todayISO();
  const user = await requireUser();

  const [spaces, places, sessions, legs, events, candidates] = await Promise.all([
    listSpaces(user.id),
    listPlacesForPicker(user.id),
    listTravelSessions(user.id),
    listLegsOnDay(user.id, day),
    travelEventsOnDay(user.id, day),
    sessionCandidates(user.id, addDaysISO(day, -14), addDaysISO(day, 60)),
  ]);

  const startPlace = places.find((p) => p.id === fromPlaceId) ?? null;
  const derived = deriveLegs(events, { startPlace });
  // A journey already saved for the same arrival is not offered again. Both
  // sides are normalised to an ISO instant: the driver hands back a Date and
  // the derivation holds a string, and comparing those two directly is how a
  // saved journey goes on being offered for ever.
  const savedKeys = new Set(
    legs
      .filter((l) => l.arriveAt)
      .map(
        (l) =>
          `${l.fromPlaceId ?? ''}→${l.toPlaceId ?? ''}@${new Date(l.arriveAt!).toISOString()}`,
      ),
  );
  const unsaved = derived.filter(
    (d) => !savedKeys.has(`${d.fromPlaceId ?? ''}→${d.toPlaceId}@${new Date(d.arriveBy).toISOString()}`),
  );

  const tripCandidates = candidates
    .map((e) => ({ event: e, draft: sessionFromEvent(e) }))
    .filter((c) => c.draft !== null)
    .slice(0, 6);

  const provider = travelTimeProvider();
  const active = sessions.filter((s) => sessionIsActive(s));

  return (
    <div className="flex min-h-screen flex-col">
      <header className="hairline border-b px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-[15px] font-semibold">Travel</h1>
          {active.length > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
              style={{ color: 'var(--accent)', background: 'var(--bg-raised)' }}
            >
              <Icon name="suitcase" size={11} />
              {active.length === 1 ? `Away — ${active[0]!.title}` : `${active.length} trips running`}
            </span>
          )}
        </div>
        <p className="muted mt-0.5 text-[12px]">
          Journeys and trips, recorded by hand or taken from the calendar. Orbit does
          not track where you are: there is no background location and the permission
          is never requested.
        </p>
      </header>

      {/* ------------------------------------------------------------ trips */}
      <section className="hairline border-b px-5 py-4">
        <h2 className="faint mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
          <Icon name="suitcase" size={11} />
          Trips
        </h2>

        {sessions.length === 0 ? (
          <p className="faint mb-3 text-[12px]">No trips recorded.</p>
        ) : (
          <ul className="mb-3 flex flex-col gap-1" aria-label="Trips" id="trip-list">
            {sessions.map((s) => (
              <li key={s.id} className="hairline row-hover flex flex-wrap items-baseline gap-2 border-b py-1.5">
                <Link
                  href={`/travel/trip/${s.id}`}
                  className="min-w-0 flex-1 truncate text-[13px] underline-offset-2 hover:underline"
                >
                  {s.title}
                </Link>
                {sessionIsActive(s) && (
                  <span className="text-[11px] font-medium" style={{ color: 'var(--accent)' }}>
                    now
                  </span>
                )}
                <span className="faint text-[11px]">
                  {formatDate(s.startsAt)} – {formatDate(s.endsAt)} ·{' '}
                  {plural(sessionDayCount(s), 'day')}
                </span>
                {s.destinationPlaceName && (
                  <span className="faint inline-flex items-center gap-1 text-[11px]">
                    <Icon name="map_pin" size={10} />
                    {s.destinationPlaceName}
                  </span>
                )}
                <span className="faint inline-flex items-center gap-1 text-[11px]">
                  <Icon name={s.source === 'calendar' ? 'calendar' : 'pin'} size={10} />
                  {s.source === 'calendar' ? 'from the calendar' : 'by hand'}
                </span>
                {s.legCount > 0 && (
                  <span className="faint text-[11px]">{plural(s.legCount, 'journey')}</span>
                )}
                <SpaceIndicator space={s.space} />
                <form action={deleteTravelSession} className="inline-flex">
                  <input type="hidden" name="sessionId" value={s.id} />
                  <button type="submit" className="faint rounded" aria-label={`Delete the trip ${s.title}`}>
                    <Icon name="x" size={11} />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {tripCandidates.length > 0 && (
          <div className="mb-3">
            <h3 className="muted mb-1 text-[11px] font-medium">
              These calendar events span more than a day
            </h3>
            <ul className="flex flex-wrap gap-2">
              {tripCandidates.map(({ event, draft }) => (
                <li key={event.id}>
                  <form action={createSessionFromEvent} className="surface flex items-center gap-2 rounded px-2 py-1.5">
                    <input type="hidden" name="eventId" value={event.id} />
                    <span className="text-[12px]">{event.title}</span>
                    <span className="faint text-[11px]">
                      {plural(sessionDayCount(draft!), 'day')}
                    </span>
                    <button type="submit" className="text-[11px] underline underline-offset-2">
                      Make it a trip
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ComposeTravelSession spaces={spaces} places={places} today={todayISO()} />
      </section>

      {/* --------------------------------------------------------- journeys */}
      <section className="hairline border-b px-5 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="faint flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
            <Icon name="route" size={11} />
            Journeys
          </h2>
          <nav className="flex items-center gap-2" aria-label="Change day">
            <Link href={`/travel?day=${addDaysISO(day, -1)}`} className="faint text-[12px]">
              ← Previous day
            </Link>
            <span className="text-[12px] font-medium">{formatDate(day)}</span>
            <Link href={`/travel?day=${addDaysISO(day, 1)}`} className="faint text-[12px]">
              Next day →
            </Link>
            {day !== todayISO() && (
              <Link href="/travel" className="faint text-[12px]">
                Today
              </Link>
            )}
          </nav>
        </div>

        {legs.length === 0 ? (
          <p className="faint mb-3 text-[12px]">Nothing recorded for this day.</p>
        ) : (
          <ul className="mb-3 flex flex-col" aria-label="Journeys on this day">
            {legs.map((l) => (
              <LegRow key={l.id} leg={l} />
            ))}
          </ul>
        )}

        <ComposeTravelLeg spaces={spaces} places={places} sessions={sessions} day={day} />
      </section>

      {/* ------------------------------------------- derived from the calendar */}
      <section className="px-5 py-4">
        <h2 className="faint mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
          <Icon name="calendar" size={11} />
          From the calendar
        </h2>
        <p className="muted mb-3 text-[12px]">
          Two events at different places imply a journey between them. Nothing here is
          saved until you say so, and the estimate comes from{' '}
          <strong>{provider.name}</strong>
          {provider.isFake
            ? ' — a table of average speeds, on this machine, with no network.'
            : ' — a routing service, over the network.'}
        </p>

        {events.length === 0 ? (
          <p className="faint text-[12px]">No events on this day.</p>
        ) : unsaved.length === 0 ? (
          <p className="faint text-[12px]">
            {derived.length === 0
              ? 'Nothing to imply a journey: the day’s events have no places, or they are all at the same one.'
              : 'Every journey this day implies is already saved.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Journeys the calendar implies">
            {unsaved.map((d) => (
              <DerivedRow key={`${d.fromPlaceId}-${d.toEventId}`} leg={d} day={day} />
            ))}
          </ul>
        )}

        {derived.length === 0 && events.some((e) => e.placeId) && (
          <div className="mt-3">
            <h3 className="muted mb-1 text-[11px] font-medium">Start the day somewhere</h3>
            <ul className="flex flex-wrap gap-2">
              {places.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/travel?day=${day}&from=${p.id}`}
                    className="surface row-hover flex items-center gap-1.5 rounded px-2 py-1 text-[12px]"
                  >
                    <Icon name="map_pin" size={11} className="faint" />
                    {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * One saved journey.
 *
 * The space indicator is here for the same reason it is on every calendar block
 * and every place row: in a merged view you have to be able to tell at a glance
 * whose journey this is.
 */
function LegRow({ leg }: { leg: TravelLegRow }) {
  const mode = (LEG_MODES as readonly string[]).includes(leg.mode) ? leg.mode : 'other';
  return (
    <li className="hairline row-hover flex flex-wrap items-baseline gap-2 border-b py-1.5">
      <Icon name={LEG_MODE_ICON[mode]} size={12} className="faint shrink-0" />
      <span className="min-w-0 flex-1 truncate text-[13px]">
        {leg.fromPlaceName ?? 'Somewhere else'}
        <span className="faint mx-1.5" aria-hidden="true">
          →
        </span>
        {leg.toPlaceName ?? 'Somewhere else'}
      </span>
      {leg.departAt && (
        <span className="text-[12px] tabular-nums">
          {formatTime(leg.departAt)}
          {leg.arriveAt && <span className="faint">–{formatTime(leg.arriveAt)}</span>}
        </span>
      )}
      {leg.durationMinutes != null && (
        <span className="faint text-[11px]">{formatDuration(leg.durationMinutes)}</span>
      )}
      {leg.distanceMetres != null && (
        <span className="faint text-[11px]">{(leg.distanceMetres / 1000).toFixed(1)} km</span>
      )}
      <span className="faint text-[11px]">
        {leg.estimateSource === 'provider'
          ? 'estimated'
          : leg.estimateSource === 'manual'
            ? 'timed'
            : 'no estimate'}
      </span>
      {leg.eventTitle && <span className="faint truncate text-[11px]">{leg.eventTitle}</span>}
      {leg.sessionTitle && (
        <span className="faint inline-flex items-center gap-1 text-[11px]">
          <Icon name="suitcase" size={10} />
          {leg.sessionTitle}
        </span>
      )}
      <SpaceIndicator space={leg.space} />

      <form action={reestimateTravelLeg} className="inline-flex items-center gap-1">
        <input type="hidden" name="legId" value={leg.id} />
        <label className="sr-only" htmlFor={`mode-${leg.id}`}>
          How this journey is made
        </label>
        {/* Keyed on the stored mode: an uncontrolled select keeps whatever the
            DOM node had when it mounted, so after a re-estimate the control
            would go on showing the mode you just changed away from. */}
        <select
          key={`${leg.id}-${mode}`}
          id={`mode-${leg.id}`}
          name="mode"
          defaultValue={mode}
          className="faint rounded bg-transparent text-[11px] outline-none"
        >
          {LEG_MODES.map((m) => (
            <option key={m} value={m}>
              {LEG_MODE_LABEL[m]}
            </option>
          ))}
        </select>
        <button type="submit" className="faint text-[11px] underline underline-offset-2">
          Re-estimate
        </button>
      </form>

      <form action={deleteTravelLeg} className="inline-flex">
        <input type="hidden" name="legId" value={leg.id} />
        <button
          type="submit"
          className="faint rounded"
          aria-label={`Delete the journey to ${leg.toPlaceName ?? 'somewhere else'}`}
        >
          <Icon name="x" size={11} />
        </button>
      </form>
    </li>
  );
}

/**
 * One journey the calendar implies, with the verdict on whether it fits.
 *
 * The estimate shown here is the crude one from the distance — asking a routing
 * provider for every derived leg on every render would be a request per render,
 * and with a real provider that is somebody's rate limit. The saved leg gets a
 * real estimate at the moment it is saved.
 */
function DerivedRow({ leg, day }: { leg: DerivedLeg; day: string }) {
  const mode: LegMode = leg.metres != null && leg.metres < 1500 ? 'walk' : 'car';
  const minutes = leg.metres == null ? 0 : estimateLegMinutes(leg.metres, mode);
  const plan = planLeg(minutes, mode);
  const verdict = fitsInGap(leg.leaveAfter, leg.arriveBy, plan);

  const tone =
    verdict.feasibility === 'impossible'
      ? 'var(--danger)'
      : verdict.feasibility === 'tight'
        ? 'var(--c-amber, var(--text-muted))'
        : 'var(--text-muted)';

  return (
    <li className="surface flex flex-wrap items-baseline gap-2 rounded p-2">
      <Icon name={LEG_MODE_ICON[mode]} size={12} className="faint shrink-0" />
      <span className="min-w-0 flex-1 truncate text-[13px]">
        {leg.fromPlaceName}
        <span className="faint mx-1.5" aria-hidden="true">
          →
        </span>
        {leg.toPlaceName}
      </span>
      <span className="text-[12px] tabular-nums">
        by {formatTime(leg.arriveBy)}
      </span>

      {leg.needsCoordinates ? (
        <span className="faint inline-flex items-center gap-1 text-[11px]">
          <Icon name="alert" size={10} />
          one end has no coordinates — no estimate
        </span>
      ) : (
        <>
          <span className="faint text-[11px]">
            about {formatDuration(plan.doorToDoorMinutes)}
            {plan.bufferBefore + plan.bufferAfter > 0 &&
              ` (${plan.travelMinutes} moving, ${plan.bufferBefore + plan.bufferAfter} either end)`}
          </span>
          <span className="text-[11px] font-medium" style={{ color: tone }}>
            {verdict.feasibility === 'impossible'
              ? `${-verdict.slackMinutes} min short`
              : verdict.feasibility === 'tight'
                ? `tight — ${verdict.slackMinutes} min spare`
                : `${verdict.slackMinutes} min spare`}
          </span>
        </>
      )}

      <form action={saveDerivedLeg} className="inline-flex items-center gap-1">
        <input type="hidden" name="spaceId" value={leg.spaceId} />
        <input type="hidden" name="fromPlaceId" value={leg.fromPlaceId ?? ''} />
        <input type="hidden" name="toPlaceId" value={leg.toPlaceId} />
        <input type="hidden" name="eventId" value={leg.toEventId} />
        <input type="hidden" name="arriveBy" value={new Date(leg.arriveBy).toISOString()} />
        <input type="hidden" name="day" value={day} />
        <label className="sr-only" htmlFor={`derived-mode-${leg.toEventId}`}>
          How this journey is made
        </label>
        <select
          id={`derived-mode-${leg.toEventId}`}
          name="mode"
          defaultValue={mode}
          className="faint rounded bg-transparent text-[11px] outline-none"
        >
          {LEG_MODES.map((m) => (
            <option key={m} value={m}>
              {LEG_MODE_LABEL[m]}
            </option>
          ))}
        </select>
        <button type="submit" className="hairline rounded border px-2 py-1 text-[11px] font-medium">
          Save this journey
        </button>
      </form>
    </li>
  );
}
