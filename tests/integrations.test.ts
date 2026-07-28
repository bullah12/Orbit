import { describe, expect, it } from 'vitest';
import {
  FakeCalendarProvider,
} from '@/lib/integrations/calendar/fake';
import { FakeIcsProvider } from '@/lib/integrations/ics/fake';
import { HttpIcsProvider } from '@/lib/integrations/ics/http';
import { GoogleCalendarProvider } from '@/lib/integrations/calendar/google';
import { NominatimGeocodingProvider } from '@/lib/integrations/geocoding/nominatim';
import { OpenRouteServiceTravelTimeProvider } from '@/lib/integrations/travel/openrouteservice';
import { WebPushProvider } from '@/lib/integrations/push/webpush';
import { parseIcs, parseIcsDuration } from '@/lib/integrations/ics/parse';
import {
  IntegrationError,
  providerSummary,
  selectAiProvider,
  selectCalendarProvider,
  selectGeocodingProvider,
  selectIcsProvider,
  selectPushProvider,
  selectTravelTimeProvider,
  UnknownProviderError,
} from '@/lib/integrations';
import { expandRecurrence } from '@/lib/recurrence';

/** What a browser's PushSubscription.toJSON() looks like. Shape only — no real keys. */
function subscriptionJson(): string {
  return JSON.stringify({
    endpoint: 'https://push.example.invalid/subscription/abc',
    keys: { p256dh: 'BF'.padEnd(87, 'A'), auth: 'AAAAAAAAAAAAAAAAAAAAAA' },
  });
}
import { londonInstant, londonTimeHHMM } from '@/lib/format';

/**
 * These tests exercise the *fakes*, which is the point of the pattern: they are
 * the implementations that run here. The real Google and HTTP classes are
 * covered only for the parts that need no network — that they refuse to act
 * without a credential, and that they never throw at construction, because the
 * app has to boot with zero credentials whatever the env says.
 */

describe('provider selection', () => {
  it('defaults every provider to the fake when nothing is set', () => {
    const env = {};
    expect(selectCalendarProvider(env).isFake).toBe(true);
    expect(selectIcsProvider(env).isFake).toBe(true);
    expect(selectGeocodingProvider(env).isFake).toBe(true);
    expect(selectTravelTimeProvider(env).isFake).toBe(true);
    expect(selectPushProvider(env).isFake).toBe(true);
    expect(selectAiProvider(env).isFake).toBe(true);
  });

  it('the env var actually selects a different implementation', () => {
    expect(selectCalendarProvider({ CALENDAR_PROVIDER: 'google' }).name).toBe('calendar:google');
    expect(selectIcsProvider({ ICS_PROVIDER: 'http' }).name).toBe('ics:http');
    expect(selectGeocodingProvider({ GEOCODING_PROVIDER: 'nominatim' }).name)
      .toBe('geocoding:nominatim');
    expect(selectTravelTimeProvider({ TRAVEL_TIME_PROVIDER: 'openrouteservice' }).name)
      .toBe('travel:openrouteservice');
  });

  it('refuses an unknown provider instead of quietly serving fixtures', () => {
    // Serving made-up data to somebody who asked for Google is the exact
    // failure this pattern exists to prevent.
    expect(() => selectCalendarProvider({ CALENDAR_PROVIDER: 'outlook' })).toThrow(UnknownProviderError);
    expect(() => selectGeocodingProvider({ GEOCODING_PROVIDER: 'google' })).toThrow(UnknownProviderError);
    expect(() => selectTravelTimeProvider({ TRAVEL_TIME_PROVIDER: 'google' })).toThrow(UnknownProviderError);
    expect(() => selectPushProvider({ PUSH_PROVIDER: 'apns' })).toThrow(UnknownProviderError);
    expect(() => selectAiProvider({ AI_PROVIDER: 'anthropic' })).toThrow(UnknownProviderError);
  });

  it('constructing a real provider without credentials does not throw', () => {
    // The app must boot with zero credentials even when pointed at Google.
    expect(() => new GoogleCalendarProvider({})).not.toThrow();
    expect(() => new HttpIcsProvider()).not.toThrow();
    expect(providerSummary({ CALENDAR_PROVIDER: 'google' })).toContainEqual({
      variable: 'CALENDAR_PROVIDER', name: 'calendar:google', isFake: false,
    });
  });

  it('the real calendar provider reports a missing credential when called', async () => {
    await expect(new GoogleCalendarProvider({}).listCalendars()).rejects.toMatchObject({
      name: 'IntegrationError',
      kind: 'missing_credential',
    });
  });

  it('the real geocoder and travel provider construct bare and refuse when called', async () => {
    // Phase 3's two real implementations. Written, never run: what is provable
    // here is that they boot without a credential and refuse to act without
    // one, which is the property the whole app depends on.
    expect(() => new NominatimGeocodingProvider({})).not.toThrow();
    expect(() => new OpenRouteServiceTravelTimeProvider({})).not.toThrow();

    await expect(new NominatimGeocodingProvider({}).geocode('Kings Heath')).rejects.toMatchObject({
      name: 'IntegrationError',
      kind: 'missing_credential',
    });
    await expect(
      new OpenRouteServiceTravelTimeProvider({}).estimate(
        { lat: 52.4, lon: -1.9 }, { lat: 52.5, lon: -1.8 }, 'drive',
      ),
    ).rejects.toMatchObject({ name: 'IntegrationError', kind: 'missing_credential' });
  });

  it('the real push provider constructs with nothing and refuses when called', async () => {
    // Phase 4's real implementation, written from RFC 8030 / 8291 / 8292 and
    // never executed against a push service. What is provable here is the same
    // thing that is provable for Nominatim and ORS: it boots without a
    // credential and will not act without one.
    expect(() => new WebPushProvider({})).not.toThrow();
    await expect(
      new WebPushProvider({}).send(subscriptionJson(), { title: 'Orbit', body: 'Bins' }),
    ).rejects.toMatchObject({ name: 'IntegrationError', kind: 'missing_credential' });
  });

  it('the real push provider refuses a subscription that is not one', async () => {
    const vapid = {
      VAPID_PUBLIC_KEY: 'not-a-real-key',
      VAPID_PRIVATE_KEY: 'not-a-real-key',
      VAPID_SUBJECT: 'mailto:nobody@example.invalid',
    };
    for (const ref of ['', 'not json', '{}', '{"endpoint":"http://insecure.example/x"}']) {
      await expect(
        new WebPushProvider(vapid).send(ref, { title: 'Orbit', body: 'Bins' }),
      ).rejects.toMatchObject({ name: 'IntegrationError', kind: 'malformed' });
    }
  });

  it('a push message never carries an external URL', async () => {
    // The one place a link becomes something somebody taps from a lock screen.
    // Refused before a credential is even read, so the check cannot be skipped
    // by an environment that happens to have one.
    await expect(
      new WebPushProvider({}).send(subscriptionJson(), {
        title: 'Orbit',
        body: 'Bins',
        href: 'https://example.invalid/phish',
      }),
    ).rejects.toMatchObject({ kind: 'malformed' });
  });

  it('the push provider selected by default is the in-memory outbox', async () => {
    const provider = selectPushProvider({});
    expect(provider.isFake).toBe(true);
    expect(provider.name).toBe('push:fake');
    await provider.send('device-1', { title: 'Orbit', body: 'Bins tonight', href: '/tasks/1' });
    expect(providerSummary({ PUSH_PROVIDER: 'webpush' })).toContainEqual({
      variable: 'PUSH_PROVIDER', name: 'push:webpush', isFake: false,
    });
  });

  it('an empty geocode query is answered without a request or a credential', async () => {
    // Nothing to look up is not an error, and it must not become a network
    // call — or, here, a credential complaint about a request nobody made.
    await expect(new NominatimGeocodingProvider({}).geocode('   ')).resolves.toEqual([]);
  });

  it('the real travel provider refuses public transport rather than answering with a car', async () => {
    // ORS has no transit profile. A driving number labelled "bus" is a lie
    // with a plausible number attached.
    await expect(
      new OpenRouteServiceTravelTimeProvider({ ORS_API_KEY: 'not-a-real-key' }).estimate(
        { lat: 52.4, lon: -1.9 }, { lat: 52.5, lon: -1.8 }, 'transit',
      ),
    ).rejects.toMatchObject({ name: 'IntegrationError', kind: 'not_found' });
  });

  it('the real ICS provider refuses a non-http scheme before any fetch', async () => {
    // A subscription URL is user-supplied; file: would read the server's disk.
    await expect(new HttpIcsProvider().fetchText({ ref: 'file:///etc/passwd' })).rejects.toBeInstanceOf(
      IntegrationError,
    );
  });
});

describe('FakeCalendarProvider', () => {
  const now = () => new Date(londonInstant('2026-06-01', '07:00'));
  const provider = new FakeCalendarProvider(now);
  const window = {
    from: londonInstant('2026-05-25', '00:00').toISOString(),
    to: londonInstant('2026-06-15', '00:00').toISOString(),
  };

  it('lists its calendars without a credential', async () => {
    const cals = await provider.listCalendars();
    expect(cals.map((c) => c.externalId)).toEqual(['family@fixture', 'work@fixture']);
  });

  it('places fixtures relative to the injected clock, not the container one', async () => {
    const page = await provider.listEvents('family@fixture', window);
    const dentist = page.events.find((e) => e.externalId === 'fx-dentist')!;
    expect(dentist.startsAt.slice(0, 10)).toBe('2026-06-04');
    expect(londonTimeHHMM(new Date(dentist.startsAt))).toBe('08:20');
  });

  it('returns a recurring event whole, with its rule, and never pre-expanded', async () => {
    const page = await provider.listEvents('work@fixture', window);
    const standup = page.events.find((e) => e.externalId === 'fx-standup')!;
    expect(standup.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=20');
    expect(page.events.filter((e) => e.externalId === 'fx-standup')).toHaveLength(1);

    // Expansion is ours, so there is exactly one implementation of what a
    // repeat means and the tests can reach it.
    const occurrences = expandRecurrence({
      rrule: standup.rrule!,
      dtstart: standup.startsAt,
      dtend: standup.endsAt,
      from: window.from,
      to: londonInstant('2026-06-08', '00:00').toISOString(),
    });
    expect(occurrences.map((o) => o.onDate)).toEqual([
      '2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05',
    ]);
  });

  it('an all-day fixture starts at London midnight, which is 23:00Z in June', async () => {
    const page = await provider.listEvents('family@fixture', window);
    const halfTerm = page.events.find((e) => e.externalId === 'fx-halfterm')!;
    expect(halfTerm.allDay).toBe(true);
    expect(halfTerm.startsAt).toBe('2026-06-05T23:00:00.000Z');
  });

  it('models an incremental pull: full, then a delta, then nothing', async () => {
    const first = await provider.listEvents('work@fixture', window);
    expect(first.events.length).toBeGreaterThan(1);
    expect(first.deletedIds).toEqual([]);
    expect(first.nextSyncToken).toBe('fixture-v1');

    const second = await provider.listEvents('work@fixture', { ...window, syncToken: first.nextSyncToken });
    expect(second.events.map((e) => e.externalId)).toEqual(['fx-funding']);
    expect(second.events[0]!.title).toContain('moved room');
    expect(second.deletedIds).toEqual(['fx-cancelled']);

    const third = await provider.listEvents('work@fixture', { ...window, syncToken: second.nextSyncToken });
    expect(third.events).toEqual([]);
    expect(third.nextSyncToken).toBe('fixture-v2');
  });

  it('treats a token it did not issue as "start again"', async () => {
    const page = await provider.listEvents('work@fixture', { ...window, syncToken: 'who-knows' });
    expect(page.nextSyncToken).toBe('fixture-v1');
    expect(page.events.length).toBeGreaterThan(1);
  });

  it('refuses a calendar it does not have', async () => {
    await expect(provider.listEvents('nope@fixture', window)).rejects.toBeInstanceOf(IntegrationError);
  });
});

describe('FakeIcsProvider and the parser', () => {
  const provider = new FakeIcsProvider();

  it('serves fixtures by name and refuses an unknown one', async () => {
    expect(provider.listFixtures()).toEqual(['bin-collections', 'school-term']);
    await expect(provider.fetchText({ ref: 'nope' })).rejects.toBeInstanceOf(IntegrationError);
  });

  it('reads the calendar name and events', async () => {
    const cal = parseIcs(await provider.fetchText({ ref: 'school-term' }));
    expect(cal.name).toBe('Kings Heath Primary — term dates');
    expect(cal.events.map((e) => e.externalId)).toEqual([
      'term-inset-2026-03@fixtures.orbit',
      'term-assembly-2026@fixtures.orbit',
      'term-cancelled-2026@fixtures.orbit',
      'term-photo-2026@fixtures.orbit',
    ]);
  });

  it('reads an all-day VALUE=DATE event as London midnight to London midnight', async () => {
    const cal = parseIcs(await provider.fetchText({ ref: 'school-term' }));
    const inset = cal.events.find((e) => e.externalId === 'term-inset-2026-03@fixtures.orbit')!;
    expect(inset.allDay).toBe(true);
    // 20 March is still GMT, so London midnight is 00:00Z.
    expect(inset.startsAt).toBe('2026-03-20T00:00:00.000Z');
    expect(inset.endsAt).toBe('2026-03-21T00:00:00.000Z');
    expect(inset.location).toBe('Kings Heath Primary, Birmingham');
  });

  it('reads a TZID time as a wall clock, not as UTC', async () => {
    const cal = parseIcs(await provider.fetchText({ ref: 'school-term' }));
    const assembly = cal.events.find((e) => e.externalId === 'term-assembly-2026@fixtures.orbit')!;
    // 23 March 09:00 London, still GMT.
    expect(assembly.startsAt).toBe('2026-03-23T09:00:00.000Z');
    expect(assembly.rrule).toBe('FREQ=WEEKLY;BYDAY=MO;COUNT=8');
    expect(assembly.exdates).toEqual(['2026-04-06T08:00:00.000Z']);
  });

  it('unfolds a folded line and unescapes the text', async () => {
    const cal = parseIcs(await provider.fetchText({ ref: 'school-term' }));
    const assembly = cal.events.find((e) => e.externalId === 'term-assembly-2026@fixtures.orbit')!;
    expect(assembly.description).toContain('Parents welcome. Runs through the clocks going forward,');
    expect(assembly.description).toContain('09:00 here is 09:00 London');
    expect(assembly.description).not.toContain('\\');
  });

  it('skips a VALARM rather than reading its TRIGGER as event data', async () => {
    const cal = parseIcs(await provider.fetchText({ ref: 'school-term' }));
    const assembly = cal.events.find((e) => e.externalId === 'term-assembly-2026@fixtures.orbit')!;
    expect(assembly.title).toBe('Monday assembly');
    expect(assembly.attendees.map((a) => a.email)).toEqual([
      'office@example.invalid', 'priya@example.invalid',
    ]);
    expect(assembly.attendees[0]!.isOrganiser).toBe(true);
    expect(assembly.attendees[1]!.response).toBe('accepted');
  });

  it('reads a Z time as UTC and a DURATION as a length', async () => {
    const cal = parseIcs(await provider.fetchText({ ref: 'school-term' }));
    const photo = cal.events.find((e) => e.externalId === 'term-photo-2026@fixtures.orbit')!;
    expect(photo.startsAt).toBe('2026-10-26T14:00:00.000Z');
    expect(Date.parse(photo.endsAt) - Date.parse(photo.startsAt)).toBe(90 * 60_000);
    expect(photo.status).toBe('tentative');
  });

  it('keeps a cancellation rather than dropping it', async () => {
    // A cancelled event that vanished would silently reappear on the next
    // import; it has to arrive so the importer can act on it.
    const cal = parseIcs(await provider.fetchText({ ref: 'school-term' }));
    const cancelled = cal.events.find((e) => e.externalId === 'term-cancelled-2026@fixtures.orbit')!;
    expect(cancelled.status).toBe('cancelled');
    // A floating time is read as London: 15 April is BST, so 16:00 is 15:00Z.
    expect(cancelled.startsAt).toBe('2026-04-15T15:00:00.000Z');
  });

  it('expands an imported rule across the spring boundary, keeping 09:00', async () => {
    const cal = parseIcs(await provider.fetchText({ ref: 'school-term' }));
    const assembly = cal.events.find((e) => e.externalId === 'term-assembly-2026@fixtures.orbit')!;
    const out = expandRecurrence({
      rrule: assembly.rrule!,
      dtstart: assembly.startsAt,
      dtend: assembly.endsAt,
      exdates: assembly.exdates,
      from: '2026-03-01T00:00:00Z',
      to: '2026-06-01T00:00:00Z',
    });
    expect(out.map((o) => o.onDate)).toEqual([
      '2026-03-23', '2026-03-30', '2026-04-13', '2026-04-20',
      '2026-04-27', '2026-05-04', '2026-05-11',
    ]);
    expect(out.every((o) => londonTimeHHMM(new Date(o.startsAt)) === '09:00')).toBe(true);
  });

  it('handles a fortnightly all-day rule with UNTIL', async () => {
    const cal = parseIcs(await provider.fetchText({ ref: 'bin-collections' }));
    const recycling = cal.events.find((e) => e.externalId === 'bins-recycling@fixtures.orbit')!;
    const out = expandRecurrence({
      rrule: recycling.rrule!,
      dtstart: recycling.startsAt,
      dtend: recycling.endsAt,
      from: '2026-10-01T00:00:00Z',
      to: '2027-01-01T00:00:00Z',
    });
    // Crosses 25 October, when the clocks go back; every one is still midnight.
    expect(out.map((o) => o.onDate)).toEqual([
      '2026-10-19', '2026-11-02', '2026-11-16', '2026-11-30', '2026-12-14', '2026-12-28',
    ]);
    expect(out.every((o) => londonTimeHHMM(new Date(o.startsAt)) === '00:00')).toBe(true);
  });

  it('rejects a document that is not a calendar', () => {
    expect(() => parseIcs('hello')).toThrow(IntegrationError);
  });

  it('parses durations, including weeks and negatives', () => {
    expect(parseIcsDuration('PT1H30M')).toBe(90 * 60_000);
    expect(parseIcsDuration('P1DT2H')).toBe(26 * 3_600_000);
    expect(parseIcsDuration('P2W')).toBe(14 * 86_400_000);
    expect(parseIcsDuration('-PT15M')).toBe(-15 * 60_000);
  });
});

describe('the phase 3+ fakes', () => {
  it('geocodes Birmingham fixtures and reverses to the nearest', async () => {
    const g = selectGeocodingProvider({});
    expect((await g.geocode('stirchley'))[0]!.label).toContain('Stirchley Baths');
    expect(await g.geocode('')).toEqual([]);
    expect((await g.reverse(52.43, -1.893))!.label).toContain('Kings Heath');
  });

  it('estimates travel time monotonically by mode', async () => {
    const t = selectTravelTimeProvider({});
    const from = { lat: 52.4297, lon: -1.8931 };
    const to = { lat: 52.4778, lon: -1.8996 };
    const walk = await t.estimate(from, to, 'walk');
    const drive = await t.estimate(from, to, 'drive');
    expect(walk.minutes).toBeGreaterThan(drive.minutes);
    expect(walk.metres).toBe(drive.metres);
    expect(walk.isEstimate).toBe(true);
  });

  it('push delivers into an outbox and nowhere else', async () => {
    const p = selectPushProvider({}) as ReturnType<typeof selectPushProvider> & {
      outbox: { message: { title: string } }[];
    };
    await p.send('sub-1', { title: 'Bins', body: 'Green bin tomorrow' });
    expect(p.outbox).toHaveLength(1);
    expect(p.outbox[0]!.message.title).toBe('Bins');
  });

  it('the AI fake says plainly that nothing left the device', async () => {
    const a = selectAiProvider({});
    const res = await a.complete({ feature: 'summarise', prompt: 'two words' });
    expect(res.text).toContain('nothing left this device');
    expect(res.model).toBe('fake-local');
  });
});
