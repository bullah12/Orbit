import { describe, expect, it } from 'vitest';
import { expandEvents } from './recurrence';
import type { Event } from '../data/types';

const event: Event = {
  id: 'event', space_id: 'space', owner_id: 'owner', title: 'Stand-up', body_md: '', location_text: null, place_id: null,
  starts_at: '2026-08-17T09:30:00.000Z', ends_at: '2026-08-17T10:00:00.000Z', all_day: false, timezone: 'Europe/London', status: 'confirmed', visibility: 'space', is_locked: false, recurrence_rule_id: 'rule',
  recurrence_rules: { id: 'rule', rrule: 'FREQ=WEEKLY;COUNT=4', dtstart: '2026-08-17T09:30:00.000Z', until: null, timezone: 'Europe/London', exdates: ['2026-08-31T09:30:00.000Z'] },
};

describe('expandEvents', () => {
  it('expands the supported weekly subset and respects exclusions', () => {
    const rows = expandEvents([event], new Date('2026-08-17T00:00:00Z'), new Date('2026-09-14T00:00:00Z'));
    expect(rows.map((row) => row.occurrenceStart)).toEqual(['2026-08-17T09:30:00.000Z', '2026-08-24T09:30:00.000Z', '2026-09-07T09:30:00.000Z']);
  });
  it('keeps private fields but does not invent them for busy records', () => {
    const busy = { ...event, title: '', body_md: '', recurrence_rules: null, recurrence_rule_id: null };
    expect(expandEvents([busy], new Date('2026-08-17'), new Date('2026-08-18'))[0]?.title).toBe('');
  });
});
