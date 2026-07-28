import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { getEvent } from '@/lib/queries/events';
import { listCategories, type CategoryOption } from '@/lib/queries/tasks';
import { listSpaces, previewMove, type SpaceSummary } from '@/lib/queries/spaces';
import { listPlaceOptions } from '@/lib/queries/places';
import { deleteEvent, moveEventToSpace, setEventPlace, updateEvent } from '@/app/actions';
import { Icon } from '@/components/Icon';
import { Markdown } from '@/components/Markdown';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { describeRrule } from '@/lib/recurrence';
import { formatDate, formatTime, londonDayISO, zonedWallClock } from '@/lib/format';
import type { EventDetail } from '@/lib/queries/events';

export const dynamic = 'force-dynamic';

/**
 * One event: read it, edit it, move it, delete it.
 *
 * A 404 rather than a 403 for an event in a space the caller cannot see. "This
 * exists but is not yours" is itself a disclosure — it tells you a space has
 * something in it.
 */
export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ moveTo?: string }>;
}) {
  const { id } = await params;
  const { moveTo } = await searchParams;
  const user = await requireUser();

  const event = await getEvent(user.id, id);
  if (!event) notFound();

  const [spaces, categories, places] = await Promise.all([
    listSpaces(user.id),
    listCategories(user.id, event.space.id),
    listPlaceOptions(user.id, event.space.id),
  ]);

  const targets = spaces.filter((s) => s.canWrite && s.id !== event.space.id);
  const target = targets.find((s) => s.id === moveTo);
  const preview = target ? await previewMove(user.id, 'event', event.id, target.id) : null;

  const day = londonDayISO(event.startsAt);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="hairline border-b px-5 py-4">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <SpaceIndicator space={event.space} size="md" />
          {event.category && (
            <span
              className="inline-flex items-center gap-1 text-[12px]"
              style={{ color: `var(--c-${event.category.colour}, var(--c-slate))` }}
            >
              <Icon name={event.category.icon} size={12} strokeWidth={2} />
              {event.category.name}
            </span>
          )}
          {event.status !== 'confirmed' && (
            <span className="faint text-[12px] capitalize">{event.status}</span>
          )}
          {event.calendarName && (
            <span className="faint text-[11px]">{event.calendarName}</span>
          )}
        </div>
        <h1 className="text-[15px] font-semibold">{event.title || 'Untitled event'}</h1>
        <p className="muted mt-0.5 text-[12px]">
          {event.allDay
            ? `${formatDate(day)} — all day`
            : `${formatDate(day)}, ${formatTime(event.startsAt)}–${formatTime(event.endsAt)}`}
          {event.locationText && ` · ${event.locationText}`}
          {event.placeName && ` · ${event.placeName}`}
        </p>
        {event.isRecurring && event.rrule && (
          <p className="faint mt-1 flex items-center gap-1 text-[12px]">
            <Icon name="undo" size={11} />
            {safeDescribe(event.rrule)} — editing changes the whole series.
          </p>
        )}
        <Link href="/calendar/week" className="faint mt-2 inline-block text-[12px]">
          ← Back to the calendar
        </Link>
      </header>

      {event.isLocked ? (
        <div className="muted flex items-start gap-2 px-5 py-6 text-[13px]">
          <Icon name="lock" size={14} className="mt-0.5 shrink-0" />
          <span>
            This event is locked. Its contents are end-to-end encrypted and the server
            has never held them, so there is nothing here to show or edit.
          </span>
        </div>
      ) : (
        <EditForm event={event} categories={categories} day={day} />
      )}

      {!event.isLocked && (
        <section className="hairline border-b px-5 py-4">
          <h2 className="faint mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
            <Icon name="map_pin" size={11} />
            Place
          </h2>
          <p className="muted mb-2 text-[12px]">
            A location typed into the field above is text. Naming a place links this
            event to a record with coordinates, which is what travel estimates need.
          </p>
          {/* A separate form: HTML has no nested forms, and this is one field. */}
          <form action={setEventPlace} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="eventId" value={event.id} />
            <div className="flex min-w-56 flex-col gap-1">
              <label htmlFor="event-place" className="faint text-[11px] font-medium">
                Place in {event.space.name}
              </label>
              <select
                id="event-place"
                name="placeId"
                defaultValue={event.placeId ?? ''}
                className="input"
              >
                <option value="">No place</option>
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.lat === null ? ' (no coordinates)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="hairline rounded border px-3 py-1.5 text-[12px] font-medium"
            >
              Save place
            </button>
            {event.placeId && (
              <Link
                href={`/places/${event.placeId}` as never}
                className="muted text-[12px] underline underline-offset-2"
              >
                Open {event.placeName}
              </Link>
            )}
          </form>
        </section>
      )}

      {event.attendees.length > 0 && (
        <section className="hairline border-b px-5 py-4">
          <h2 className="faint mb-2 text-[10px] font-semibold uppercase tracking-wider">
            Attendees
          </h2>
          <ul className="flex flex-col gap-1">
            {event.attendees.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-2 text-[13px]">
                <Icon name="user" size={11} className="faint shrink-0" />
                {a.personId ? (
                  <Link href={`/people/${a.personId}`} className="truncate">
                    {a.displayName ?? a.email}
                  </Link>
                ) : (
                  <span className="truncate">{a.displayName ?? a.email}</span>
                )}
                {a.isOrganiser && <span className="faint text-[11px]">organiser</span>}
                <span className="muted ml-auto text-[11px]">{responseLabel(a.response)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {event.bodyMd.trim() !== '' && (
        <section className="hairline border-b px-5 py-4">
          <h2 className="faint mb-2 text-[10px] font-semibold uppercase tracking-wider">Notes</h2>
          <Markdown source={event.bodyMd} />
        </section>
      )}

      <MoveSection event={event} targets={targets} target={target} preview={preview ?? []} />

      <section className="px-5 py-4">
        <form action={deleteEvent}>
          <input type="hidden" name="eventId" value={event.id} />
          <button
            type="submit"
            className="hairline row-hover rounded border px-2 py-1 text-[12px]"
            style={{ color: 'var(--danger)' }}
          >
            Delete this event
          </button>
        </form>
      </section>
    </div>
  );
}

function EditForm({
  event,
  categories,
  day,
}: {
  event: EventDetail;
  categories: CategoryOption[];
  day: string;
}) {
  const startTime = zonedWallClock(event.startsAt).time.slice(0, 5);
  const endTime = zonedWallClock(event.endsAt).time.slice(0, 5);

  return (
    <form action={updateEvent} className="hairline border-b px-5 py-4" aria-label="Edit event">
      <input type="hidden" name="eventId" value={event.id} />

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="faint text-[11px] font-medium">Title</span>
          <input name="title" defaultValue={event.title} className="input" required />
        </label>

        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1">
            <span className="faint text-[11px] font-medium">Date</span>
            <input type="date" name="onDate" defaultValue={day} className="input" required />
          </label>
          <label className="flex flex-col gap-1">
            <span className="faint text-[11px] font-medium">From</span>
            <input type="time" name="startTime" defaultValue={startTime} className="input" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="faint text-[11px] font-medium">To</span>
            <input type="time" name="endTime" defaultValue={endTime} className="input" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="faint text-[11px] font-medium">All day</span>
            <span className="flex h-[30px] items-center">
              <input type="checkbox" name="allDay" value="true" defaultChecked={event.allDay} />
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="faint text-[11px] font-medium">Status</span>
            <select name="status" defaultValue={event.status} className="input">
              <option value="confirmed">Confirmed</option>
              <option value="tentative">Tentative</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="faint text-[11px] font-medium">Category</span>
            <select name="categoryId" defaultValue={event.categoryId ?? ''} className="input">
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="faint text-[11px] font-medium">Location</span>
          <input name="locationText" defaultValue={event.locationText ?? ''} className="input" />
        </label>

        <label className="flex flex-col gap-1">
          <span className="faint text-[11px] font-medium">Notes (Markdown)</span>
          <textarea name="bodyMd" defaultValue={event.bodyMd} rows={4} className="input" />
        </label>

        <div>
          <button
            type="submit"
            className="rounded px-3 py-1.5 text-[12px] font-medium"
            style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
          >
            Save changes
          </button>
        </div>
      </div>
    </form>
  );
}

function MoveSection({
  event,
  targets,
  target,
  preview,
}: {
  event: EventDetail;
  targets: SpaceSummary[];
  target: SpaceSummary | undefined;
  preview: { change: string; displayName: string; reason: string }[];
}) {
  const gains = preview.filter((p) => p.change === 'gains');
  const loses = preview.filter((p) => p.change === 'loses');
  const keeps = preview.filter((p) => p.change === 'keeps');

  return (
    <section className="hairline border-b px-5 py-4">
      <h2 className="faint mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
        <Icon name="move" size={11} />
        Move to another space
      </h2>

      {targets.length === 0 ? (
        <p className="faint text-[12px]">There is nowhere else to move this.</p>
      ) : !target ? (
        <>
          <p className="muted mb-2 text-[12px]">
            Pick a destination. You will see exactly who gains and loses access before
            anything changes.
          </p>
          <ul className="flex flex-wrap gap-2">
            {targets.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/calendar/event/${event.id}?moveTo=${s.id}`}
                  className="surface row-hover flex items-center gap-2 rounded px-2 py-1.5"
                  aria-label={`Preview moving this event to ${s.name}`}
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
          <div className="mb-3 flex items-center gap-2 text-[13px]">
            <SpaceIndicator space={event.space} size="md" />
            <Icon name="arrow_right" size={13} className="faint" />
            <SpaceIndicator space={target} size="md" />
          </div>

          <div className="flex flex-col gap-2 text-[12px]">
            {loses.length > 0 && (
              <Group tone="var(--danger)" heading="These people lose access" people={loses} />
            )}
            {gains.length > 0 && (
              <Group tone="var(--accent)" heading="These people gain access" people={gains} />
            )}
            {keeps.length > 0 && (
              <Group tone="var(--text-muted)" heading="Unchanged" people={keeps} />
            )}
            {preview.length === 0 && <p className="faint">Nobody’s access changes.</p>}
          </div>

          <p className="muted mt-3 flex items-start gap-1.5 text-[12px]">
            <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
            <span>
              Attendees move with the event.
              {event.category && (
                <>
                  {' '}The category{' '}
                  <strong className="font-medium">{event.category.name}</strong> belongs to{' '}
                  {event.space.name} and will be cleared.
                </>
              )}{' '}
              Calendars belong to a space too, so this moves into{' '}
              {target.name}’s default calendar. Any place it was linked to is cleared,
              because places are space-scoped as well.
            </span>
          </p>

          <div className="mt-4 flex items-center gap-3">
            <form action={moveEventToSpace}>
              <input type="hidden" name="eventId" value={event.id} />
              <input type="hidden" name="targetSpaceId" value={target.id} />
              <button
                type="submit"
                className="rounded px-3 py-1.5 text-[12px] font-medium"
                style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
              >
                Move to {target.name}
              </button>
            </form>
            <Link href={`/calendar/event/${event.id}`} className="muted text-[12px]">
              Cancel
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

function Group({
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
      <p className="font-medium" style={{ color: tone }}>{heading}</p>
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

function responseLabel(response: string): string {
  return (
    { accepted: 'Accepted', declined: 'Declined', tentative: 'Maybe', needs_action: 'No reply' }[
      response
    ] ?? response
  );
}

function safeDescribe(rrule: string): string {
  try {
    return describeRrule(rrule);
  } catch {
    return 'Repeats on a rule Orbit cannot read';
  }
}
