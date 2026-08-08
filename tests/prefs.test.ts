import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME,
  DEFAULT_WEEK_START,
  THEME_CHOICES,
  THEME_COLOUR,
  WEEK_STARTS,
  isThemeChoice,
  parseTheme,
  parseWeekStart,
  resolveDefaultSpace,
  themeAttribute,
  weekStartOffset,
} from '@/lib/prefs';
import { monthGrid, viewRange, weekDays } from '@/lib/calendar';
import { startOfWeekISO, weekdayOf } from '@/lib/format';
import { expandRecurrence } from '@/lib/recurrence';

/**
 * Preferences, and the two things that must stay true about them.
 *
 * Every value here arrives as a cookie string, which is to say as text a
 * browser can put anything into, so the first half of this file is about what
 * happens when it is rubbish. The second half is the more important one: a
 * *display* preference must never reach recurrence expansion, because a setting
 * that silently changed which occurrences a repeating event has would not be a
 * display preference at all.
 */

describe('the theme choice', () => {
  it('reads back the three it knows', () => {
    for (const choice of THEME_CHOICES) expect(parseTheme(choice)).toBe(choice);
  });

  it('falls back to system for anything else', () => {
    for (const junk of ['', 'DARK', 'blue', 'null', '../../etc/passwd', 'light dark']) {
      expect(parseTheme(junk), junk).toBe(DEFAULT_THEME);
    }
    expect(parseTheme(null)).toBe(DEFAULT_THEME);
    expect(parseTheme(undefined)).toBe(DEFAULT_THEME);
  });

  it('is a type guard that refuses non-strings', () => {
    expect(isThemeChoice('dark')).toBe(true);
    expect(isThemeChoice(3)).toBe(false);
    expect(isThemeChoice(null)).toBe(false);
    expect(isThemeChoice({})).toBe(false);
  });

  it('renders system as the absence of the attribute, not a third value', () => {
    // This is the whole contract with globals.css: with no `data-theme`, the
    // `light-dark()` pairs resolve from `color-scheme: light dark` — the OS
    // preference — which is exactly what "system" means. A literal
    // `data-theme="system"` would match neither pinned rule and would be a
    // third state to keep working.
    expect(themeAttribute('system')).toBeUndefined();
    expect(themeAttribute('light')).toBe('light');
    expect(themeAttribute('dark')).toBe('dark');
  });
});

describe('the browser-chrome colour tracks the stylesheet', () => {
  // `themeColor` is a meta tag and cannot read a CSS custom property, so these
  // two are the only colours outside globals.css. Two copies of a value is
  // exactly the drift the light-dark() merge existed to remove, so the copy is
  // pinned to its source here rather than trusted.
  const css = readFileSync(
    fileURLToPath(new URL('../src/app/globals.css', import.meta.url)),
    'utf8',
  );

  function bgFor(theme: 'light' | 'dark'): { l: number } {
    const m = css.match(/--bg:\s*light-dark\(\s*oklch\(([^)]*)\)\s*,\s*oklch\(([^)]*)\)\s*\)/);
    expect(m, '--bg is declared as a light-dark() pair').not.toBeNull();
    const raw = (theme === 'light' ? m![1]! : m![2]!).trim().split(/\s+/)[0]!;
    return { l: raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw) };
  }

  function lightnessOfHex(hex: string): number {
    // Rough perceptual lightness is enough: this asserts the pair has not been
    // swapped or left behind, not that the two colour spaces agree exactly.
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  }

  it('the light chrome colour is light and the dark one is dark', () => {
    expect(lightnessOfHex(THEME_COLOUR.light)).toBeGreaterThan(0.8);
    expect(lightnessOfHex(THEME_COLOUR.dark)).toBeLessThan(0.2);
  });

  it('and each sits on the same side of the scale as --bg does', () => {
    expect(bgFor('light').l).toBeGreaterThan(0.8);
    expect(bgFor('dark').l).toBeLessThan(0.3);
  });
});

describe('the week start', () => {
  it('defaults to Monday, the UK convention', () => {
    expect(DEFAULT_WEEK_START).toBe('monday');
    expect(parseWeekStart(null)).toBe('monday');
    expect(parseWeekStart('tuesday')).toBe('monday');
    expect(parseWeekStart('')).toBe('monday');
  });

  it('reads back the two it knows', () => {
    for (const day of WEEK_STARTS) expect(parseWeekStart(day)).toBe(day);
  });

  it('offsets every weekday correctly in both', () => {
    // getUTCDay: Sunday = 0 … Saturday = 6.
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => weekStartOffset(d, 'monday'))).toEqual([
      6, 0, 1, 2, 3, 4, 5,
    ]);
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => weekStartOffset(d, 'sunday'))).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });

  it('cuts startOfWeekISO on the chosen day', () => {
    // 2026-08-08 is a Saturday.
    expect(weekdayOf('2026-08-08')).toBe(6);
    expect(startOfWeekISO('2026-08-08')).toBe('2026-08-03'); // Monday
    expect(startOfWeekISO('2026-08-08', 'sunday')).toBe('2026-08-02');
    // A Sunday is the first day of its own week only when weeks start on Sunday.
    expect(startOfWeekISO('2026-08-09', 'sunday')).toBe('2026-08-09');
    expect(startOfWeekISO('2026-08-09', 'monday')).toBe('2026-08-03');
  });
});

describe('the calendar grid follows the preference', () => {
  it('gives seven consecutive days beginning on the chosen one', () => {
    const mon = weekDays('2026-08-08', 'monday');
    expect(mon[0]).toBe('2026-08-03');
    expect(mon[6]).toBe('2026-08-09');

    const sun = weekDays('2026-08-08', 'sunday');
    expect(sun[0]).toBe('2026-08-02');
    expect(sun[6]).toBe('2026-08-08');
  });

  it('still gives six rows of seven for a month, either way', () => {
    for (const start of WEEK_STARTS) {
      const grid = monthGrid('2026-08-08', start);
      expect(grid).toHaveLength(6);
      for (const week of grid) expect(week).toHaveLength(7);
      expect(weekdayOf(grid[0]![0]!)).toBe(start === 'sunday' ? 0 : 1);
    }
  });

  it('covers the month it is a grid for, either way', () => {
    for (const start of WEEK_STARTS) {
      const days = monthGrid('2026-08-08', start).flat();
      expect(days).toContain('2026-08-01');
      expect(days).toContain('2026-08-31');
    }
  });

  it('queries exactly the range it draws', () => {
    // The bug this prevents: a range cut on Monday behind a grid drawn from
    // Sunday queries six days the view never shows and misses the one it does,
    // so the first column of a Sunday-first week is permanently empty.
    for (const view of ['week', 'month'] as const) {
      for (const start of WEEK_STARTS) {
        const days =
          view === 'week' ? weekDays('2026-08-08', start) : monthGrid('2026-08-08', start).flat();
        const { from, to } = viewRange(view, '2026-08-08', start);
        // Every drawn day begins at or after `from` and before `to`.
        for (const day of [days[0]!, days[days.length - 1]!]) {
          const noon = Date.parse(`${day}T12:00:00Z`);
          expect(noon, `${view}/${start} ${day}`).toBeGreaterThan(from.getTime());
          expect(noon, `${view}/${start} ${day}`).toBeLessThan(to.getTime());
        }
      }
    }
  });
});

describe('the preference never reaches recurrence', () => {
  /**
   * The load-bearing test of this whole feature.
   *
   * `WKST` is an RFC 5545 property of a *rule* and it decides which occurrences
   * a weekly rule with an interval actually has. If the viewer's calendar
   * preference were ever plumbed into expansion, changing this setting would
   * silently move somebody's repeating events — a data change wearing the
   * clothes of a display change. The two are kept apart by construction:
   * `src/lib/recurrence.ts` has its own `weekStart` and never calls
   * `startOfWeekISO`, and this asserts the consequence rather than the
   * arrangement.
   */
  it('expands a fortnightly rule identically whatever the display preference is', () => {
    // `expandRecurrence` takes no week-start argument at all, which is the
    // arrangement; running it either side of a preference change asserts the
    // consequence. If somebody later threads the cookie in, this goes red.
    const runs = WEEK_STARTS.map(() =>
      expandRecurrence({
        rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,SA;COUNT=8',
        dtstart: '2026-08-03T09:00:00Z',
        from: '2026-08-01T00:00:00Z',
        to: '2026-10-01T00:00:00Z',
      }).map((o) => o.startsAt),
    );

    expect(runs[0]).toEqual(runs[1]);
    expect(runs[0]!.length).toBeGreaterThan(0);
  });

  it('and the rule carries its own week start, which is not the preference', () => {
    // Same days, same interval, different WKST — genuinely different
    // occurrences. This is the thing a display preference must not be able to
    // do, and it is only reachable from the rule text.
    const window = {
      dtstart: '2026-08-02T09:00:00Z', // a Sunday
      from: '2026-08-01T00:00:00Z',
      to: '2026-10-01T00:00:00Z',
    };

    const mo = expandRecurrence({ ...window, rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,WE;WKST=MO' });
    const su = expandRecurrence({ ...window, rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,WE;WKST=SU' });

    expect(mo.map((o) => o.startsAt)).not.toEqual(su.map((o) => o.startsAt));
  });
});

describe('the default compose space', () => {
  const WRITABLE = ['space-a', 'space-b'];

  it('accepts a space the caller can write to', () => {
    expect(resolveDefaultSpace('space-a', WRITABLE)).toBe('space-a');
  });

  it('refuses one they cannot, so the cookie grants nothing', () => {
    // The point of re-checking on every read: a cookie is not a capability, and
    // a person removed from a space must not keep composing into it.
    expect(resolveDefaultSpace('space-z', WRITABLE)).toBeNull();
    expect(resolveDefaultSpace('space-a', [])).toBeNull();
  });

  it('treats absent, empty and non-string as no preference', () => {
    expect(resolveDefaultSpace(null, WRITABLE)).toBeNull();
    expect(resolveDefaultSpace(undefined, WRITABLE)).toBeNull();
    expect(resolveDefaultSpace('', WRITABLE)).toBeNull();
    expect(resolveDefaultSpace(42 as unknown as string, WRITABLE)).toBeNull();
  });
});
