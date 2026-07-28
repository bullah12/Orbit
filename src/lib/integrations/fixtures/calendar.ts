/**
 * Fixture calendar data for the fake CalendarProvider.
 *
 * Generated relative to an injectable `now` rather than hard-coded to 2026, so
 * a demo always has something in this week — and so a test can pin the clock
 * and get the same events every run. Same rule as src/lib/format.ts: a fixture
 * that depends on the container's clock is testing the container.
 */

import { addDaysISO, londonDayISO, londonInstant } from '@/lib/format';
import type { ExternalCalendar, ExternalEvent } from '../types';

export const FAKE_CALENDARS: ExternalCalendar[] = [
  { externalId: 'family@fixture', name: 'Family (fixture)', timezone: 'Europe/London', writable: true },
  { externalId: 'work@fixture', name: 'Work (fixture)', timezone: 'Europe/London', writable: false },
];

type Spec = {
  id: string;
  calendar: string;
  dayOffset: number;
  start: string;
  end: string;
  title: string;
  location?: string;
  allDay?: boolean;
  rrule?: string;
  status?: ExternalEvent['status'];
  attendees?: { name: string; email: string; organiser?: boolean }[];
};

const SPECS: Spec[] = [
  {
    id: 'fx-standup', calendar: 'work@fixture', dayOffset: 0, start: '09:30', end: '09:45',
    title: 'Stand-up', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=20',
    attendees: [{ name: 'Priya Raghavan', email: 'priya@example.invalid', organiser: true }],
  },
  {
    id: 'fx-funding', calendar: 'work@fixture', dayOffset: 1, start: '14:00', end: '15:30',
    title: 'Funding panel', location: 'Council House, Victoria Square',
    attendees: [
      { name: 'Dr Iqbal', email: 'iqbal@example.invalid' },
      { name: 'Priya Raghavan', email: 'priya@example.invalid', organiser: true },
    ],
  },
  {
    id: 'fx-swimming', calendar: 'family@fixture', dayOffset: 2, start: '17:15', end: '18:00',
    title: 'Swimming lesson', location: 'Stirchley Baths',
    rrule: 'FREQ=WEEKLY;BYDAY=WE;COUNT=12',
  },
  {
    id: 'fx-dentist', calendar: 'family@fixture', dayOffset: 3, start: '08:20', end: '08:50',
    title: 'Dentist — checkup', location: 'Kings Heath',
  },
  {
    id: 'fx-halfterm', calendar: 'family@fixture', dayOffset: 5, start: '00:00', end: '00:00',
    title: 'Half term', allDay: true,
  },
  {
    id: 'fx-cancelled', calendar: 'work@fixture', dayOffset: 4, start: '11:00', end: '12:00',
    title: 'Budget review', status: 'cancelled',
  },
];

function toEvent(spec: Spec, todayISO: string, revision: number): ExternalEvent {
  const day = addDaysISO(todayISO, spec.dayOffset);
  const startsAt = spec.allDay
    ? londonInstant(day, '00:00')
    : londonInstant(day, spec.start);
  const endsAt = spec.allDay
    ? londonInstant(addDaysISO(day, 1), '00:00')
    : londonInstant(day, spec.end);

  return {
    externalId: spec.id,
    etag: `${spec.id}/${revision}`,
    // The revision shows up in the title so an incremental pull is visible in
    // the UI as well as in a test assertion.
    title: revision > 1 && spec.id === 'fx-funding' ? `${spec.title} (moved room)` : spec.title,
    description: '',
    location: spec.location ?? null,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    allDay: spec.allDay ?? false,
    timezone: 'Europe/London',
    status: spec.status ?? 'confirmed',
    rrule: spec.rrule ?? null,
    exdates: [],
    attendees: (spec.attendees ?? []).map((a) => ({
      email: a.email,
      displayName: a.name,
      response: a.organiser ? 'accepted' : 'needs_action',
      isOrganiser: a.organiser ?? false,
    })),
  };
}

export function fixtureEvents(
  calendarExternalId: string,
  now: Date,
  revision: number,
): ExternalEvent[] {
  const today = londonDayISO(now);
  return SPECS.filter((s) => s.calendar === calendarExternalId).map((s) =>
    toEvent(s, today, revision),
  );
}

/** What the second pull reports as gone. One id, so a delta is never empty and never large. */
export const FIXTURE_DELETED_ON_SECOND_PULL = ['fx-cancelled'];
