/**
 * REAL IMPLEMENTATION — WRITTEN, NEVER RUN.
 *
 * Google Calendar API v3, written from the published reference. There is no
 * OAuth client and no network in the environment Orbit is built in, so not one
 * line of this has been executed. Do not describe it as working, and do not let
 * `FakeCalendarProvider` stand in for it in a claim that it does.
 *
 * Selected with CALENDAR_PROVIDER=google. It needs GOOGLE_CLIENT_ID,
 * GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN; without them it throws when
 * *called*, never at import, so the app still boots with zero credentials.
 *
 * Decisions it encodes:
 *  - `singleEvents=false`, so a recurring event arrives as one row plus its
 *    RRULE and Orbit expands it. Google's own expansion would give us a second
 *    implementation of recurrence that no test here could reach.
 *  - `showDeleted=true`, so a cancellation is a deletion we can act on rather
 *    than a row that silently stops arriving.
 *  - A 410 on a sync token means the cursor is too old; the caller is told to
 *    drop it and do a full window pull, which is what Google documents.
 */

import {
  IntegrationError,
  type CalendarPage,
  type CalendarProvider,
  type CalendarWindow,
  type ExternalAttendee,
  type ExternalCalendar,
  type ExternalEvent,
  type OutgoingEvent,
  type PushedEvent,
} from '../types';
import { TZ, zonedInstant } from '@/lib/format';

const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

type GoogleDate = { date?: string; dateTime?: string; timeZone?: string };

type GoogleEvent = {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleDate;
  end?: GoogleDate;
  recurrence?: string[];
  organizer?: { email?: string; displayName?: string };
  attendees?: { email?: string; displayName?: string; responseStatus?: string; organizer?: boolean }[];
};

export class GoogleCalendarProvider implements CalendarProvider {
  readonly name = 'calendar:google';
  readonly isFake = false;

  private accessToken: string | null = null;
  private accessTokenExpiry = 0;

  constructor(
    private readonly env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
  ) {}

  private credentials() {
    const clientId = this.env.GOOGLE_CLIENT_ID;
    const clientSecret = this.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = this.env.GOOGLE_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) {
      throw new IntegrationError(
        'calendar:google',
        'missing_credential',
        'set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN, or leave CALENDAR_PROVIDER=fake',
      );
    }
    return { clientId, clientSecret, refreshToken };
  }

  /** Refresh-token grant. Cached with 60s of slack so a request never races the expiry. */
  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiry - 60_000) return this.accessToken;
    const { clientId, clientSecret, refreshToken } = this.credentials();

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      throw new IntegrationError('calendar:google', 'missing_credential', `token refresh failed: ${res.status}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = json.access_token;
    this.accessTokenExpiry = Date.now() + json.expires_in * 1000;
    return this.accessToken;
  }

  private async get(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const url = new URL(`${API}${path}`);
    for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);

    const res = await fetch(url, { headers: { authorization: `Bearer ${await this.token()}` } });
    if (res.status === 410) {
      // Documented: the sync token has expired. Not an error the user can fix.
      throw new IntegrationError('calendar:google', 'not_found', 'sync token expired — full resync required');
    }
    if (!res.ok) {
      throw new IntegrationError('calendar:google', 'transport', `${res.status} ${res.statusText}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  async listCalendars(): Promise<ExternalCalendar[]> {
    const out: ExternalCalendar[] = [];
    let pageToken = '';
    do {
      const json = await this.get('/users/me/calendarList', { pageToken, maxResults: '250' });
      const items = (json.items ?? []) as {
        id: string; summary?: string; timeZone?: string; accessRole?: string;
      }[];
      for (const c of items) {
        out.push({
          externalId: c.id,
          name: c.summary ?? c.id,
          timezone: c.timeZone ?? TZ,
          writable: c.accessRole === 'owner' || c.accessRole === 'writer',
        });
      }
      pageToken = String(json.nextPageToken ?? '');
    } while (pageToken);
    return out;
  }

  async listEvents(calendarExternalId: string, window: CalendarWindow): Promise<CalendarPage> {
    const events: ExternalEvent[] = [];
    const deletedIds: string[] = [];
    let pageToken = '';
    let nextSyncToken: string | null = null;

    do {
      // timeMin/timeMax are not permitted alongside a syncToken; Google returns
      // 400 if both are sent, so an incremental pull deliberately sends neither.
      const params: Record<string, string> = window.syncToken
        ? { syncToken: window.syncToken, pageToken, showDeleted: 'true', singleEvents: 'false' }
        : {
            timeMin: new Date(window.from).toISOString(),
            timeMax: new Date(window.to).toISOString(),
            pageToken,
            showDeleted: 'true',
            singleEvents: 'false',
            maxResults: '2500',
          };

      const json = await this.get(`/calendars/${encodeURIComponent(calendarExternalId)}/events`, params);
      for (const item of (json.items ?? []) as GoogleEvent[]) {
        if (item.status === 'cancelled' && !item.start) {
          // A tombstone from an incremental pull: id only, no times.
          deletedIds.push(item.id);
          continue;
        }
        const mapped = mapEvent(item);
        if (mapped) events.push(mapped);
      }
      pageToken = String(json.nextPageToken ?? '');
      nextSyncToken = (json.nextSyncToken as string | undefined) ?? nextSyncToken;
    } while (pageToken);

    return { events, deletedIds, nextSyncToken };
  }

  /**
   * Write one event back to Google. **Written, never run.**
   *
   * `POST /calendars/{id}/events` to create, `PUT .../events/{eventId}` to
   * update. The update carries `If-Match: <etag>`, so Google refuses with 412
   * when the event moved on their side since we read it — the same shape as
   * Orbit's own conflict handling, and the reason the etag is stored at all.
   * A 412 is reported as a conflict rather than swallowed: `is_dirty` stays
   * set, and the local edit is still there to send again.
   *
   * An all-day event is written as a bare `date`, and — per RFC 5545, which
   * Google follows — the end date is *exclusive*, so a one-day event ends on
   * the following day. Getting that wrong is the classic off-by-one that makes
   * every all-day event a day short.
   */
  async pushEvent(calendarExternalId: string, event: OutgoingEvent): Promise<PushedEvent> {
    const body: Record<string, unknown> = {
      summary: event.title,
      description: event.description,
      location: event.location ?? undefined,
      status: event.status,
      start: googleDate(event.startsAt, event.allDay, event.timezone),
      end: googleDate(event.endsAt, event.allDay, event.timezone, event.allDay),
    };

    const create = event.externalId === null;
    const url = new URL(
      `${API}/calendars/${encodeURIComponent(calendarExternalId)}/events${
        create ? '' : `/${encodeURIComponent(event.externalId!)}`
      }`,
    );

    const headers: Record<string, string> = {
      authorization: `Bearer ${await this.token()}`,
      'content-type': 'application/json',
    };
    // A conditional write only if we have something to be conditional about.
    if (!create && event.etag) headers['if-match'] = event.etag;

    const res = await fetch(url, {
      method: create ? 'POST' : 'PUT',
      headers,
      body: JSON.stringify(body),
    });

    if (res.status === 412) {
      throw new IntegrationError(
        'calendar:google',
        'transport',
        'the event changed on Google since it was read here — the local edit has been kept and not sent',
      );
    }
    if (res.status === 403) {
      throw new IntegrationError('calendar:google', 'read_only', 'this calendar cannot be written to');
    }
    if (!res.ok) {
      throw new IntegrationError('calendar:google', 'transport', `${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as { id?: string; etag?: string };
    if (!json.id) {
      throw new IntegrationError('calendar:google', 'malformed', 'the write came back without an id');
    }
    return { externalId: json.id, etag: json.etag ?? null, created: create };
  }
}

/**
 * A Google date-time, or a bare date for an all-day event.
 *
 * `exclusiveEnd` shifts an all-day end on by one day, because Google's end date
 * is exclusive and Orbit's is not.
 */
function googleDate(
  instant: string,
  allDay: boolean,
  timezone: string,
  exclusiveEnd = false,
): Record<string, string> {
  if (!allDay) return { dateTime: new Date(instant).toISOString(), timeZone: timezone };
  const d = new Date(instant);
  if (exclusiveEnd) d.setUTCDate(d.getUTCDate() + 1);
  return { date: d.toISOString().slice(0, 10) };
}

function mapDate(d: GoogleDate | undefined): { instant: string; allDay: boolean; tz: string } | null {
  if (!d) return null;
  if (d.date) {
    // All-day: a bare calendar date. Anchored at London midnight, which is what
    // every other all-day value in Orbit means.
    return { instant: zonedInstant(d.date, '00:00:00', TZ).toISOString(), allDay: true, tz: TZ };
  }
  if (d.dateTime) {
    return { instant: new Date(d.dateTime).toISOString(), allDay: false, tz: d.timeZone ?? TZ };
  }
  return null;
}

function mapAttendee(a: {
  email?: string; displayName?: string; responseStatus?: string; organizer?: boolean;
}): ExternalAttendee {
  const r = a.responseStatus;
  return {
    email: a.email?.toLowerCase() ?? null,
    displayName: a.displayName ?? null,
    response:
      r === 'accepted' ? 'accepted'
      : r === 'declined' ? 'declined'
      : r === 'tentative' ? 'tentative'
      : 'needs_action',
    isOrganiser: a.organizer ?? false,
  };
}

function mapEvent(item: GoogleEvent): ExternalEvent | null {
  const start = mapDate(item.start);
  const end = mapDate(item.end);
  if (!start) return null;

  const rrule = (item.recurrence ?? [])
    .find((line) => line.toUpperCase().startsWith('RRULE:'))
    ?.slice('RRULE:'.length) ?? null;
  const exdates = (item.recurrence ?? [])
    .filter((line) => line.toUpperCase().startsWith('EXDATE'))
    .flatMap((line) => line.slice(line.indexOf(':') + 1).split(','))
    .map((v) =>
      /^\d{8}$/.test(v)
        ? zonedInstant(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, '00:00:00', TZ).toISOString()
        : new Date(v).toISOString(),
    );

  const attendees = (item.attendees ?? []).map(mapAttendee);
  if (item.organizer?.email && !attendees.some((a) => a.isOrganiser)) {
    attendees.unshift({
      email: item.organizer.email.toLowerCase(),
      displayName: item.organizer.displayName ?? null,
      response: 'accepted',
      isOrganiser: true,
    });
  }

  return {
    externalId: item.id,
    etag: item.etag ?? null,
    title: item.summary ?? '',
    description: item.description ?? '',
    location: item.location ?? null,
    startsAt: start.instant,
    endsAt: end?.instant ?? start.instant,
    allDay: start.allDay,
    timezone: start.tz,
    status:
      item.status === 'cancelled' ? 'cancelled' : item.status === 'tentative' ? 'tentative' : 'confirmed',
    rrule,
    exdates,
    attendees,
  };
}
