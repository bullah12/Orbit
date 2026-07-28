/**
 * Fixture .ics documents.
 *
 * Kept as a TypeScript string rather than a file on disk so it survives Next's
 * bundling and is readable from a test, a server component and a route handler
 * without anyone having to know where the repo root is at runtime.
 *
 * Every awkward shape a real publisher emits is in here on purpose: a folded
 * line, an escaped comma, CRLF endings, a floating time, a UTC time, an
 * all-day event, a VALARM to be skipped, a cancellation, a recurrence that
 * crosses the BST boundary, and an EXDATE.
 */

/** Written with CRLF, as RFC 5545 requires and as real feeds arrive. */
function crlf(s: string): string {
  return s.replace(/\n/g, '\r\n');
}

export const SCHOOL_TERM_ICS = crlf(`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Orbit fixtures//Kings Heath Primary//EN
X-WR-CALNAME:Kings Heath Primary — term dates
X-WR-TIMEZONE:Europe/London
BEGIN:VEVENT
UID:term-inset-2026-03@fixtures.orbit
DTSTAMP:20260101T000000Z
DTSTART;VALUE=DATE:20260320
DTEND;VALUE=DATE:20260321
SUMMARY:INSET day — school closed
LOCATION:Kings Heath Primary\\, Birmingham
END:VEVENT
BEGIN:VEVENT
UID:term-assembly-2026@fixtures.orbit
DTSTAMP:20260101T000000Z
DTSTART;TZID=Europe/London:20260323T090000
DTEND;TZID=Europe/London:20260323T093000
RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=8
EXDATE;TZID=Europe/London:20260406T090000
SUMMARY:Monday assembly
DESCRIPTION:Parents welcome. Runs through the clocks going forward\\, so the
  09:00 here is 09:00 London on both sides of the boundary.
ORGANIZER;CN=School office:mailto:office@example.invalid
ATTENDEE;CN=Priya Raghavan;PARTSTAT=ACCEPTED:mailto:priya@example.invalid
BEGIN:VALARM
TRIGGER:-PT15M
ACTION:DISPLAY
DESCRIPTION:Assembly
END:VALARM
END:VEVENT
BEGIN:VEVENT
UID:term-photo-2026@fixtures.orbit
DTSTAMP:20260101T000000Z
DTSTART:20261026T140000Z
DURATION:PT1H30M
SUMMARY:Class photographs
STATUS:TENTATIVE
END:VEVENT
BEGIN:VEVENT
UID:term-cancelled-2026@fixtures.orbit
DTSTAMP:20260101T000000Z
DTSTART:20260415T160000
DTEND:20260415T170000
SUMMARY:Parents evening (cancelled)
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR
`);

export const BIN_COLLECTION_ICS = crlf(`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Orbit fixtures//Birmingham City Council//EN
X-WR-CALNAME:Bin collections — B14
BEGIN:VEVENT
UID:bins-recycling@fixtures.orbit
DTSTAMP:20260101T000000Z
DTSTART;VALUE=DATE:20261019
SUMMARY:Recycling — green bin
RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;UNTIL=20261231T000000Z
END:VEVENT
BEGIN:VEVENT
UID:bins-general@fixtures.orbit
DTSTAMP:20260101T000000Z
DTSTART;VALUE=DATE:20261026
SUMMARY:General waste
RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=4
END:VEVENT
END:VCALENDAR
`);

/** Fixture name → document. The fake IcsProvider serves exactly these. */
export const ICS_FIXTURES: Record<string, string> = {
  'school-term': SCHOOL_TERM_ICS,
  'bin-collections': BIN_COLLECTION_ICS,
};
