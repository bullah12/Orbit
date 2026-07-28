/**
 * Provider selection.
 *
 * `.env.example` declares six `*_PROVIDER` variables and the ADR promises they
 * select an implementation. This is the file that makes that true. The default
 * for every one of them is `fake`, so the app boots and demos with zero
 * credentials — that is a hard requirement, not a convenience.
 *
 * An unknown value is a **hard error at selection time**, not a silent fall
 * back to the fake. Quietly serving fixture data to somebody who asked for
 * Google is the exact failure this whole pattern exists to prevent.
 *
 * Selection is memoised per process. Pass an explicit env to `select*` in a
 * test rather than mutating process.env.
 */

import type {
  AiProvider,
  CalendarProvider,
  GeocodingProvider,
  IcsProvider,
  PushProvider,
  TravelTimeProvider,
} from './types';
import { FakeCalendarProvider } from './calendar/fake';
import { GoogleCalendarProvider } from './calendar/google';
import { FakeIcsProvider } from './ics/fake';
import { HttpIcsProvider } from './ics/http';
import { FakeGeocodingProvider } from './geocoding/fake';
import { NominatimGeocodingProvider } from './geocoding/nominatim';
import { FakeTravelTimeProvider } from './travel/fake';
import { OpenRouteServiceTravelTimeProvider } from './travel/openrouteservice';
import { FakePushProvider } from './push/fake';
import { WebPushProvider } from './push/webpush';
import { FakeAiProvider } from './ai/fake';

export * from './types';
export { parseIcs, parseIcsDate, parseIcsDuration } from './ics/parse';

type Env = Record<string, string | undefined>;

export class UnknownProviderError extends Error {
  constructor(variable: string, value: string, known: string[]) {
    super(`${variable}=${value} is not a provider Orbit knows (${known.join(' | ')})`);
    this.name = 'UnknownProviderError';
  }
}

function choose<T>(
  variable: string,
  env: Env,
  table: Record<string, () => T>,
): T {
  const value = (env[variable] ?? 'fake').trim();
  const make = table[value];
  if (!make) throw new UnknownProviderError(variable, value, Object.keys(table));
  return make();
}

export function selectCalendarProvider(env: Env = process.env): CalendarProvider {
  return choose<CalendarProvider>('CALENDAR_PROVIDER', env, {
    fake: () => new FakeCalendarProvider(),
    google: () => new GoogleCalendarProvider(env),
  });
}

export function selectIcsProvider(env: Env = process.env): IcsProvider {
  return choose<IcsProvider>('ICS_PROVIDER', env, {
    fake: () => new FakeIcsProvider(),
    http: () => new HttpIcsProvider(),
  });
}

/**
 * Phase 3 wrote both real implementations below. Neither has ever executed a
 * request — there is no network and no credential here — so what the tests
 * verify is that each constructs happily without one and refuses to act when
 * called without one.
 */
export function selectGeocodingProvider(env: Env = process.env): GeocodingProvider {
  return choose<GeocodingProvider>('GEOCODING_PROVIDER', env, {
    fake: () => new FakeGeocodingProvider(),
    nominatim: () => new NominatimGeocodingProvider(env),
  });
}

export function selectTravelTimeProvider(env: Env = process.env): TravelTimeProvider {
  return choose<TravelTimeProvider>('TRAVEL_TIME_PROVIDER', env, {
    fake: () => new FakeTravelTimeProvider(),
    openrouteservice: () => new OpenRouteServiceTravelTimeProvider(env),
  });
}

/**
 * Phase 4 wrote the real push provider: Web Push against RFC 8030 / 8291 /
 * 8292. Like the two Phase 3 wrote, it has never executed a request — what the
 * tests verify is that it constructs with no credential and refuses when
 * called without one.
 */
export function selectPushProvider(env: Env = process.env): PushProvider {
  return choose<PushProvider>('PUSH_PROVIDER', env, {
    fake: () => new FakePushProvider(),
    webpush: () => new WebPushProvider(env),
  });
}

/**
 * Phase 5 owns the real AI provider. Only `fake` is listed, so asking for one
 * today fails loudly with the list of what exists rather than serving fixtures
 * under another name.
 */

export function selectAiProvider(env: Env = process.env): AiProvider {
  return choose<AiProvider>('AI_PROVIDER', env, { fake: () => new FakeAiProvider() });
}

// --- process-wide singletons ----------------------------------------------
// Server components resolve a provider per render; constructing one is cheap
// but the fake push outbox and the Google access-token cache must not be
// per-render, so they are held here.

const singletons = new Map<string, unknown>();

function once<T>(key: string, make: () => T): T {
  if (!singletons.has(key)) singletons.set(key, make());
  return singletons.get(key) as T;
}

export const calendarProvider = () => once('calendar', () => selectCalendarProvider());
export const icsProvider = () => once('ics', () => selectIcsProvider());
export const geocodingProvider = () => once('geocoding', () => selectGeocodingProvider());
export const travelTimeProvider = () => once('travel', () => selectTravelTimeProvider());
export const pushProvider = () => once('push', () => selectPushProvider());
export const aiProvider = () => once('ai', () => selectAiProvider());

/** What the settings screen shows: which implementation is live, and whether it is a fake. */
export function providerSummary(env: Env = process.env) {
  const rows: { variable: string; name: string; isFake: boolean }[] = [];
  const add = (variable: string, p: { name: string; isFake: boolean }) =>
    rows.push({ variable, name: p.name, isFake: p.isFake });
  add('CALENDAR_PROVIDER', selectCalendarProvider(env));
  add('ICS_PROVIDER', selectIcsProvider(env));
  add('GEOCODING_PROVIDER', selectGeocodingProvider(env));
  add('TRAVEL_TIME_PROVIDER', selectTravelTimeProvider(env));
  add('PUSH_PROVIDER', selectPushProvider(env));
  add('AI_PROVIDER', selectAiProvider(env));
  return rows;
}
