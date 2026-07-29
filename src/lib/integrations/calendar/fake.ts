import type {
  CalendarPage,
  CalendarProvider,
  CalendarWindow,
  ExternalCalendar,
  OutgoingEvent,
  PushedEvent,
} from '../types';
import { IntegrationError } from '../types';
import {
  FAKE_CALENDARS,
  FIXTURE_DELETED_ON_SECOND_PULL,
  fixtureEvents,
} from '../fixtures/calendar';

/**
 * The default CalendarProvider. Fixture-backed, no network, no credential.
 *
 * It models the one part of a real calendar API that matters to the rest of
 * Orbit: **incremental pulls**. A first call (no token) returns everything in
 * the window and a token; a call carrying that token returns only what changed
 * since, including deletions. Phase 6's sync tests are written against this,
 * so the fake has to be honest about the shape even though the data is made up.
 *
 * `now` is injectable for the same reason the date helpers take one — fixtures
 * are positioned relative to today, and a test that depends on the container's
 * clock is testing the container.
 */
export class FakeCalendarProvider implements CalendarProvider {
  readonly name = 'calendar:fake';
  readonly isFake = true;

  constructor(private readonly now: () => Date = () => new Date()) {}

  async listCalendars(): Promise<ExternalCalendar[]> {
    return FAKE_CALENDARS.map((c) => ({ ...c }));
  }

  async listEvents(calendarExternalId: string, window: CalendarWindow): Promise<CalendarPage> {
    if (!FAKE_CALENDARS.some((c) => c.externalId === calendarExternalId)) {
      throw new IntegrationError(
        'calendar:fake',
        'not_found',
        `no fixture calendar "${calendarExternalId}"`,
      );
    }

    const revision = tokenRevision(window.syncToken) + 1;
    const all = fixtureEvents(calendarExternalId, this.now(), revision);

    // The window filter is on the *first* instance only. An event carrying an
    // RRULE is returned whole and expanded by src/lib/recurrence.ts — the
    // provider never decides what a repeat means.
    const from = Date.parse(window.from);
    const to = Date.parse(window.to);
    const inWindow = all.filter((e) => Date.parse(e.startsAt) < to && Date.parse(e.endsAt) > from);

    if (revision === 1) {
      return { events: inWindow, deletedIds: [], nextSyncToken: 'fixture-v1' };
    }
    if (revision === 2) {
      // A delta: the one event whose title changed, plus a deletion.
      return {
        events: inWindow.filter((e) => e.externalId === 'fx-funding'),
        deletedIds: FIXTURE_DELETED_ON_SECOND_PULL.filter((id) =>
          all.some((e) => e.externalId === id),
        ),
        nextSyncToken: 'fixture-v2',
      };
    }
    // Steady state: nothing has changed, and the token does not move.
    return { events: [], deletedIds: [], nextSyncToken: window.syncToken ?? 'fixture-v2' };
  }

  /**
   * Accept a write, and say honestly what it did with it.
   *
   * The fake keeps pushed events in memory for the life of the process, which
   * is enough to model the part that matters to Orbit: a create comes back
   * with an id we did not choose, an update keeps the id it was given, and both
   * come back with a new etag — so `is_dirty` is cleared against something that
   * actually changed rather than against nothing.
   *
   * It does **not** model a conditional write failing. A real provider can
   * refuse a stale etag; this one cannot, and pretending otherwise would make
   * the push path look tested when the interesting half of it never runs here.
   */
  async pushEvent(calendarExternalId: string, event: OutgoingEvent): Promise<PushedEvent> {
    if (!FAKE_CALENDARS.some((c) => c.externalId === calendarExternalId)) {
      throw new IntegrationError(
        'calendar:fake',
        'not_found',
        `no fixture calendar "${calendarExternalId}"`,
      );
    }
    const calendar = FAKE_CALENDARS.find((c) => c.externalId === calendarExternalId);
    if (calendar && !calendar.writable) {
      throw new IntegrationError(
        'calendar:fake',
        'read_only',
        `fixture calendar "${calendarExternalId}" is subscribed, not owned — it cannot be written to`,
      );
    }

    // Every write gets a number, not only every create: an update that came
    // back with the etag it went out with would let a caller clear is_dirty
    // against a version that had not moved.
    const revision = ++this.pushCounter;
    const created = event.externalId === null;
    const externalId = event.externalId ?? `fx-pushed-${revision}`;
    const etag = `fx-etag-${externalId}-${revision}`;
    this.pushed.set(externalId, { ...event, externalId, etag });
    return { externalId, etag, created };
  }

  /** What this process has been asked to push. Test and demo only. */
  readonly pushed = new Map<string, OutgoingEvent>();
  private pushCounter = 0;
}

function tokenRevision(token: string | null | undefined): number {
  if (!token) return 0;
  const m = /^fixture-v(\d+)$/.exec(token);
  if (!m) {
    // A token we did not issue means the other side lost its place. Real APIs
    // answer that with "full resync required"; so does this.
    return 0;
  }
  return Number(m[1]);
}
