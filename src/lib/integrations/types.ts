/**
 * Every external service Orbit touches sits behind one of these interfaces.
 *
 * Two implementations each: a fixture-backed **fake**, which is the default and
 * the one the tests exercise; and a **real** one written against the published
 * API, which cannot be executed in this environment and is marked as such in
 * STATUS.md. The app must boot, run and demo with zero credentials, so nothing
 * here may throw at module load because a key is missing — a provider that
 * needs a credential reports that when it is *called*, as a typed error.
 *
 * These types are deliberately free of `Date`. Instants cross the boundary as
 * ISO 8601 strings and are turned into London-local anything exactly once, in
 * src/lib/format.ts.
 */

/** Thrown by a real provider that has no credential, or by a fake asked for a fixture it does not have. */
export class IntegrationError extends Error {
  constructor(
    readonly provider: string,
    readonly kind: 'missing_credential' | 'not_found' | 'transport' | 'malformed',
    message: string,
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'IntegrationError';
  }
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export type ExternalAttendee = {
  email: string | null;
  displayName: string | null;
  response: 'needs_action' | 'accepted' | 'declined' | 'tentative';
  isOrganiser: boolean;
};

/**
 * One event as an external system describes it.
 *
 * `startsAt`/`endsAt` are ISO instants for timed events. For an all-day event
 * they are the London-midnight instants of the first and last-plus-one day, so
 * that a caller never has to know which shape it is holding.
 *
 * `rrule` is the raw RFC 5545 line without the `RRULE:` prefix. Expansion is
 * ours (src/lib/recurrence.ts) and never the provider's — that keeps one
 * implementation of the rules that the tests can reach.
 */
export type ExternalEvent = {
  externalId: string;
  etag: string | null;
  title: string;
  description: string;
  location: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timezone: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  rrule: string | null;
  /** Instants (or dates for all-day rules) the recurrence explicitly skips. */
  exdates: string[];
  attendees: ExternalAttendee[];
};

export type ExternalCalendar = {
  externalId: string;
  name: string;
  timezone: string;
  /** Best-effort; providers that do not say assume writable. */
  writable: boolean;
};

export type CalendarWindow = {
  /** ISO instant, inclusive. */
  from: string;
  /** ISO instant, exclusive. */
  to: string;
  /** Opaque cursor from a previous pull; a provider free to ignore it must still return a new one. */
  syncToken?: string | null;
};

export type CalendarPage = {
  events: ExternalEvent[];
  /** External ids the provider says are gone. Never a hard delete on our side. */
  deletedIds: string[];
  nextSyncToken: string | null;
};

export interface CalendarProvider {
  readonly name: string;
  /** True when this implementation can actually reach the network here. */
  readonly isFake: boolean;
  listCalendars(): Promise<ExternalCalendar[]>;
  listEvents(calendarExternalId: string, window: CalendarWindow): Promise<CalendarPage>;
}

// ---------------------------------------------------------------------------
// ICS
//
// The provider only *fetches bytes*. Parsing is local and shared by both
// implementations (src/lib/integrations/ics/parse.ts), so the fake and the real
// one cannot disagree about what an .ics file means — which is the only part a
// test in this container can actually prove.
// ---------------------------------------------------------------------------

export type IcsSource = {
  /** A URL for the http provider; a fixture name for the fake. */
  ref: string;
};

export interface IcsProvider {
  readonly name: string;
  readonly isFake: boolean;
  /** Raw iCalendar text. Callers pass it to parseIcs(). */
  fetchText(source: IcsSource): Promise<string>;
}

// ---------------------------------------------------------------------------
// Geocoding — Phase 3
// ---------------------------------------------------------------------------

export type GeocodeResult = {
  label: string;
  lat: number;
  lon: number;
  /** 0–1. The fake is always confident; a real one rarely is. */
  confidence: number;
};

export interface GeocodingProvider {
  readonly name: string;
  readonly isFake: boolean;
  geocode(query: string): Promise<GeocodeResult[]>;
  reverse(lat: number, lon: number): Promise<GeocodeResult | null>;
}

// ---------------------------------------------------------------------------
// Travel time — Phase 3
// ---------------------------------------------------------------------------

export type TravelMode = 'walk' | 'cycle' | 'drive' | 'transit';

export type TravelEstimate = {
  mode: TravelMode;
  minutes: number;
  metres: number;
  /** True when the number came from a table of averages rather than a routing engine. */
  isEstimate: boolean;
};

export interface TravelTimeProvider {
  readonly name: string;
  readonly isFake: boolean;
  estimate(
    from: { lat: number; lon: number },
    to: { lat: number; lon: number },
    mode: TravelMode,
    departAt?: string,
  ): Promise<TravelEstimate>;
}

// ---------------------------------------------------------------------------
// Push — Phase 4
// ---------------------------------------------------------------------------

export type PushMessage = {
  title: string;
  body: string;
  /** In-app path. Never an external URL. */
  href?: string;
};

export interface PushProvider {
  readonly name: string;
  readonly isFake: boolean;
  send(subscriptionRef: string, message: PushMessage): Promise<{ delivered: boolean }>;
}

// ---------------------------------------------------------------------------
// AI — Phase 5
//
// Off by default, per-feature opt-in (decision 8). Note what is absent: there
// is no path here for a locked item, and NL capture parsing does not use this
// interface at all — it is local-only and must never touch the network.
// ---------------------------------------------------------------------------

export type AiRequest = {
  feature: string;
  prompt: string;
  /** Caller asserts none of this came from a locked item. */
  context?: string;
};

export interface AiProvider {
  readonly name: string;
  readonly isFake: boolean;
  complete(request: AiRequest): Promise<{ text: string; model: string }>;
}
