import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { getPlace, type PlaceRow } from '@/lib/queries/places';
import { categoriesBySpace } from '@/lib/queries/tasks';
import {
  addPlaceVisit,
  archivePlace,
  geocodePlace,
  movePlaceToSpace,
  removePlaceVisit,
  restorePlace,
  updatePlace,
} from '@/app/actions';
import { listSpaces, previewMove, type SpaceSummary } from '@/lib/queries/spaces';
import { SpaceIndicator, CategoryChip } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { Markdown } from '@/components/Markdown';
import { formatDateTime, formatRelative, londonDayISO, todayISO } from '@/lib/format';
import { geocodingProvider } from '@/lib/integrations';

export const dynamic = 'force-dynamic';

export default async function PlacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ moveTo?: string; geocoded?: string }>;
}) {
  const { id } = await params;
  const { moveTo, geocoded } = await searchParams;
  const user = await requireUser();
  const result = await getPlace(user.id, id);

  // Not found and not permitted are the same response on purpose: a 403 would
  // confirm the place exists.
  if (!result) notFound();
  const { place, visits, events, notes, people } = result;

  const [spaces, categories] = await Promise.all([
    listSpaces(user.id),
    categoriesBySpace(user.id),
  ]);
  const categoryOptions = categories[place.space.id] ?? [];
  const moveTargets = spaces.filter((sp) => sp.canWrite && sp.id !== place.space.id);
  const moveTarget = moveTargets.find((sp) => sp.id === moveTo);
  const movePreview = moveTarget
    ? await previewMove(user.id, 'place', place.id, moveTarget.id)
    : null;

  // Which geocoder is live is a fact about this build, and the page says so
  // rather than implying a lookup went out to the internet.
  const geocoder = geocodingProvider();

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col">
      <header className="hairline border-b px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/places" className="faint text-xs">
            Places
          </Link>
          <span className="faint text-xs" aria-hidden="true">
            /
          </span>
          <SpaceIndicator space={place.space} />
          <CategoryChip category={place.category} />
          {place.visibility === 'private' && (
            <span className="faint flex items-center gap-1 text-2xs">
              <Icon name="eye_off" size={11} />
              Private to you
            </span>
          )}
          <span className="faint ml-auto text-2xs">
            Edited {formatRelative(place.updatedAt)}
          </span>
        </div>
        {place.archivedAt && (
          <p className="muted mt-2 flex flex-wrap items-center gap-2 text-xs">
            <Icon name="archive" size={12} />
            Archived {formatRelative(place.archivedAt)}.
            <form action={restorePlace} className="inline">
              <input type="hidden" name="placeId" value={place.id} />
              <button type="submit" className="underline underline-offset-2">
                Restore it
              </button>
            </form>
          </p>
        )}
      </header>

      {place.isLocked ? (
        <div className="muted flex items-center gap-2 px-5 py-10 text-sm">
          <Icon name="lock" size={14} />
          This place is locked. It is end-to-end encrypted and can only be opened on a
          device holding the key — the server has never seen its name or address.
        </div>
      ) : (
        <>
          <form action={updatePlace} className="flex flex-col gap-3 px-5 py-4">
            <input type="hidden" name="placeId" value={place.id} />
            <label htmlFor="place-name" className="sr-only">
              Place name
            </label>
            <input
              id="place-name"
              name="name"
              defaultValue={place.name}
              required
              className="bg-transparent text-xl font-semibold outline-none"
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Address" htmlFor="place-address">
                <input
                  id="place-address"
                  name="addressText"
                  defaultValue={place.addressText ?? ''}
                  className="input"
                />
              </Field>
              <Field label="Postcode" htmlFor="place-postcode">
                <input
                  id="place-postcode"
                  name="postcode"
                  defaultValue={place.postcode ?? ''}
                  className="input uppercase"
                />
              </Field>
              <Field label="Town or city" htmlFor="place-city">
                <input
                  id="place-city"
                  name="city"
                  defaultValue={place.city ?? ''}
                  className="input"
                />
              </Field>
              <Field label="Category" htmlFor="place-category">
                <select
                  id="place-category"
                  name="categoryId"
                  defaultValue={
                    categoryOptions.find((c) => c.name === place.category?.name)?.id ?? ''
                  }
                  className="input"
                >
                  <option value="">No category</option>
                  {categoryOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Latitude" htmlFor="place-lat">
                <input
                  id="place-lat"
                  name="lat"
                  inputMode="decimal"
                  defaultValue={place.lat === null ? '' : String(place.lat)}
                  className="input font-mono"
                />
              </Field>
              <Field label="Longitude" htmlFor="place-lon">
                <input
                  id="place-lon"
                  name="lon"
                  inputMode="decimal"
                  defaultValue={place.lon === null ? '' : String(place.lon)}
                  className="input font-mono"
                />
              </Field>
            </div>

            <Field label="Notes (Markdown)" htmlFor="place-notes">
              <textarea
                id="place-notes"
                name="notesMd"
                defaultValue={place.notesMd}
                rows={6}
                className="input resize-y font-mono text-xs leading-relaxed"
              />
            </Field>

            <div>
              <button
                type="submit"
                className="rounded px-3 py-1.5 text-xs font-medium btn-primary"
              >
                Save changes
              </button>
            </div>
          </form>

          {place.notesMd.trim() !== '' && (
            <section className="hairline border-t px-5 py-4">
              <h2 className="faint mb-2 text-2xs font-semibold uppercase tracking-wider">
                Rendered
              </h2>
              <Markdown source={place.notesMd} />
            </section>
          )}

          <GeocodeSection place={place} geocoder={geocoder} outcome={geocoded ?? null} />
        </>
      )}

      <section className="hairline border-t px-5 py-4">
        <h2 className="faint mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider">
          <Icon name="check" size={11} />
          Visits
        </h2>
        <p className="muted mb-3 text-xs">
          Recorded by hand or derived from the calendar. Nothing here comes from a
          device’s location — Orbit never asks for that permission.
        </p>

        {visits.length >= 50 && (
          <p className="faint mb-2 text-2xs">
            Showing the 50 most recent visits. There is no paging yet.
          </p>
        )}

        {visits.length === 0 ? (
          <p className="faint mb-3 text-xs">No visits recorded.</p>
        ) : (
          <ul className="mb-3 flex flex-col gap-1" aria-label="Recorded visits">
            {visits.map((v) => (
              <li key={v.id} className="flex flex-wrap items-baseline gap-2 text-xs">
                <span>{formatDateTime(v.arrivedAt)}</span>
                {v.departedAt && (
                  <span className="faint">
                    → {formatDateTime(v.departedAt).split(', ').pop()}
                  </span>
                )}
                <span className="faint inline-flex items-center gap-1 text-2xs">
                  <Icon name={v.source === 'calendar' ? 'calendar' : 'pin'} size={10} />
                  {v.source === 'calendar' ? 'from the calendar' : 'logged by hand'}
                </span>
                {v.eventTitle && <span className="faint text-2xs">{v.eventTitle}</span>}
                {v.notesMd && <span className="muted">{v.notesMd}</span>}
                <form action={removePlaceVisit} className="inline-flex">
                  <input type="hidden" name="visitId" value={v.id} />
                  <button
                    type="submit"
                    className="faint rounded"
                    aria-label={`Remove the visit on ${formatDateTime(v.arrivedAt)}`}
                  >
                    <Icon name="x" size={11} />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {!place.isLocked && !place.archivedAt && (
          <form action={addPlaceVisit} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="placeId" value={place.id} />
            <Field label="Date" htmlFor="visit-date">
              <input
                id="visit-date"
                type="date"
                name="onDate"
                required
                defaultValue={todayISO()}
                className="input"
              />
            </Field>
            <Field label="Arrived" htmlFor="visit-arrived">
              <input id="visit-arrived" type="time" name="arrivedTime" className="input" />
            </Field>
            <Field label="Left" htmlFor="visit-departed">
              <input id="visit-departed" type="time" name="departedTime" className="input" />
            </Field>
            <Field label="Note" htmlFor="visit-note">
              <input id="visit-note" name="notesMd" className="input" />
            </Field>
            <button
              type="submit"
              className="hairline rounded border px-3 py-1.5 text-xs font-medium"
            >
              Log a visit
            </button>
          </form>
        )}
      </section>

      <section className="hairline border-t px-5 py-4">
        <h2 className="faint mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider">
          <Icon name="link" size={11} />
          Linked
        </h2>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <h3 className="muted mb-1 text-2xs font-medium">
              Events here{events.length >= 25 ? ' — 25 most recent' : ''}
            </h3>
            {events.length === 0 ? (
              <p className="faint text-xs">None.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline gap-1.5 text-xs">
                    <Link
                      href={`/calendar/event/${e.id}` as never}
                      className="underline underline-offset-2"
                    >
                      {e.title}
                    </Link>
                    <span className="faint text-2xs">
                      {e.allDay ? londonDayISO(e.startsAt) : formatDateTime(e.startsAt)}
                    </span>
                    <SpaceIndicator space={e.space} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="muted mb-1 text-2xs font-medium">Notes</h3>
            {notes.length === 0 ? (
              <p className="faint text-xs">None.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {notes.map((n) => (
                  <li key={n.id} className="text-xs">
                    <Link href={`/notes/${n.id}` as never} className="underline underline-offset-2">
                      {n.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="muted mb-1 text-2xs font-medium">People seen here</h3>
            {people.length === 0 ? (
              <p className="faint text-xs">Nobody yet.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {people.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-baseline gap-1.5 text-xs">
                    <Link href={`/people/${p.id}` as never} className="underline underline-offset-2">
                      {p.displayName}
                    </Link>
                    <span className="faint text-2xs">
                      {p.times === 1 ? 'once' : `${p.times}×`}
                    </span>
                    <SpaceIndicator space={p.space} />
                  </li>
                ))}
              </ul>
            )}
            <p className="faint mt-1 text-2xs">
              Derived from event attendees. Nobody recorded this.
            </p>
          </div>
        </div>
      </section>

      <PlaceMoveSection
        place={place}
        eventCount={events.length}
        targets={moveTargets}
        target={moveTarget}
        preview={movePreview ?? []}
      />

      {!place.archivedAt && (
        <section className="hairline border-t px-5 py-4">
          <form action={archivePlace} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="placeId" value={place.id} />
            <button
              type="submit"
              className="hairline rounded border px-3 py-1.5 text-xs font-medium"
            >
              <span className="inline-flex items-center gap-1.5">
                <Icon name="archive" size={12} />
                Archive
              </span>
            </button>
            <span className="faint text-xs">
              Archiving is reversible and keeps the visits. A place is never deleted:
              events and travel legs point at it.
            </span>
          </form>
        </section>
      )}
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
      <label htmlFor={htmlFor} className="faint text-2xs font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Resolve coordinates through the GeocodingProvider.
 *
 * The button says which implementation will answer, because "geocode" reads
 * like "goes to the internet" and with the default provider it does not.
 */
function GeocodeSection({
  place,
  geocoder,
  outcome,
}: {
  place: PlaceRow;
  geocoder: { name: string; isFake: boolean };
  outcome: string | null;
}) {
  const query = [place.name, place.addressText, place.postcode, place.city]
    .filter(Boolean)
    .join(', ');

  return (
    <section className="hairline border-t px-5 py-4">
      <h2 className="faint mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider">
        <Icon name="map_pin" size={11} />
        Coordinates
      </h2>

      <p className="muted mb-2 text-xs" id="geocode-status" aria-live="polite">
        {place.lat === null ? (
          'No coordinates yet. Travel estimates need them.'
        ) : (
          <>
            <span className="font-mono">
              {place.lat.toFixed(5)}, {place.lon!.toFixed(5)}
            </span>{' '}
            — from {place.geocodeSource ?? 'manual'}
            {place.geocodedAt && <> , {formatRelative(place.geocodedAt)}</>}
          </>
        )}
        {outcome === 'ok' && ' Looked up just now.'}
        {outcome === 'none' && ' The geocoder found nothing for that address.'}
        {outcome === 'error' &&
          ' The geocoder refused: it needs a credential this build does not have.'}
      </p>

      {!place.archivedAt && (
        <form action={geocodePlace} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="placeId" value={place.id} />
          <div className="flex min-w-64 flex-1 flex-col gap-1">
            <label htmlFor="geocode-query" className="faint text-2xs font-medium">
              Look up
            </label>
            <input
              id="geocode-query"
              name="query"
              defaultValue={query}
              className="input"
              aria-describedby="geocode-status geocode-provider"
            />
          </div>
          <button
            type="submit"
            className="hairline rounded border px-3 py-1.5 text-xs font-medium"
          >
            Find coordinates
          </button>
        </form>
      )}

      <p className="faint mt-2 text-2xs" id="geocode-provider">
        {geocoder.isFake
          ? `Running ${geocoder.name}: a fixed table of Birmingham locations, matched by substring. Nothing leaves this machine.`
          : `Running ${geocoder.name}: this sends the address above to an external service.`}
      </p>
    </section>
  );
}

/**
 * Move a place between spaces.
 *
 * The fifth and last entity type to get one, which completes the hard
 * requirement: every entity that can move now names who gains and who loses
 * before anything is written. A place's own consequence is that things pointing
 * at it from the space it is leaving stop pointing at it.
 */
function PlaceMoveSection({
  place,
  eventCount,
  targets,
  target,
  preview,
}: {
  place: PlaceRow;
  eventCount: number;
  targets: SpaceSummary[];
  target: SpaceSummary | undefined;
  preview: { change: string; displayName: string; reason: string }[];
}) {
  const gains = preview.filter((p) => p.change === 'gains');
  const loses = preview.filter((p) => p.change === 'loses');
  const keeps = preview.filter((p) => p.change === 'keeps');

  return (
    <section className="hairline border-t px-5 py-4">
      <h2 className="faint mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider">
        <Icon name="move" size={11} />
        Move to another space
      </h2>

      {targets.length === 0 ? (
        <p className="faint text-xs">There is nowhere else to move this.</p>
      ) : !target ? (
        <>
          <p className="muted mb-2 text-xs">
            Pick a destination. You will see exactly who gains and loses access before
            anything changes.
          </p>
          <ul className="flex flex-wrap gap-2">
            {targets.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/places/${place.id}?moveTo=${s.id}`}
                  className="surface row-hover flex items-center gap-2 rounded px-2 py-1.5"
                  aria-label={`Preview moving this place to ${s.name}`}
                >
                  <SpaceIndicator space={s} />
                  <Icon name="arrow_right" size={11} className="faint" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="surface rounded-md p-4">
          <div className="mb-3 flex items-center gap-2 text-sm">
            <SpaceIndicator space={place.space} size="md" />
            <Icon name="arrow_right" size={13} className="faint" />
            <SpaceIndicator space={target} size="md" />
          </div>

          <div className="flex flex-col gap-2 text-xs">
            {loses.length > 0 && (
              <MoveGroup tone="var(--danger)" heading="These people lose access" people={loses} />
            )}
            {gains.length > 0 && (
              <MoveGroup tone="var(--accent)" heading="These people gain access" people={gains} />
            )}
            {keeps.length > 0 && (
              <MoveGroup tone="var(--text-muted)" heading="Unchanged" people={keeps} />
            )}
            {preview.length === 0 && <p className="faint">Nobody’s access changes.</p>}
          </div>

          <p className="muted mt-3 flex items-start gap-1.5 text-xs">
            <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
            <span>
              The address, the coordinates and the visits move with the place. Its
              category belongs to {place.space.name} and is cleared.
              {eventCount > 0 && (
                <>
                  {' '}
                  {eventCount === 1 ? 'One event' : `${eventCount} events`} held here stay
                  where they are; any left in {place.space.name} stop naming this place
                  rather than pointing at something their readers can no longer see.
                </>
              )}
            </span>
          </p>

          <div className="mt-4 flex items-center gap-3">
            <form action={movePlaceToSpace}>
              <input type="hidden" name="placeId" value={place.id} />
              <input type="hidden" name="targetSpaceId" value={target.id} />
              <button
                type="submit"
                className="rounded px-3 py-1.5 text-xs font-medium btn-primary"
              >
                Move to {target.name}
              </button>
            </form>
            <Link href={`/places/${place.id}`} className="muted text-xs">
              Cancel
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

function MoveGroup({
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
      <p className="font-medium" style={{ color: tone }}>
        {heading}
      </p>
      <ul className="muted mt-0.5 flex flex-col gap-0.5">
        {people.map((p) => (
          <li key={`${p.displayName}-${p.reason}`}>
            {p.displayName} — <span className="faint">{p.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
