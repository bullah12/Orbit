import { describe, expect, it } from 'vitest';
import { addDays, isoDate, startOfWeek } from './date';

describe('date helpers', () => {
  it('starts UK weeks on Monday', () => expect(isoDate(startOfWeek(new Date('2026-08-19T12:00:00')))).toBe('2026-08-17'));
  it('uses calendar arithmetic across month boundaries', () => expect(isoDate(addDays(new Date('2026-08-31T12:00:00'), 1))).toBe('2026-09-01'));
});
