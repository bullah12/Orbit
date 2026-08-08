/**
 * Preferences: the small set of choices a person makes about their own copy of
 * Orbit, and the rules for reading them back safely.
 *
 * Everything here is pure. The values arrive as cookie strings — which is to
 * say, as text a browser can put anything into — so every one of them is parsed
 * through a function that falls back to a default rather than trusting what it
 * was given. `src/lib/prefs/cookies.ts` is the only part that touches a jar.
 *
 * **Cookies rather than a table, and why that is not laziness.** The theme has
 * to be known *before the first paint*, which rules out anything fetched after
 * the page renders: a `useEffect` that swaps the theme is the flash this file
 * exists to prevent. Every page in Orbit is `force-dynamic` and already reads
 * cookies (`orbit_user`, `orbit_device`), so the server can apply the choice to
 * the `<html>` element on the way out. That also means these preferences need
 * no migration, which is the constraint Brief C set.
 *
 * The cost is recorded rather than hidden: a preference in a cookie belongs to
 * a browser, not to an account. Sign in on a second device and it starts at the
 * defaults. For a theme that is arguably right — a phone at night and a desktop
 * at noon genuinely want different answers — and for the default compose space
 * it is a mild annoyance. Moving them onto `profiles` is a migration and a
 * decision about whether they are per-account or per-device; see
 * `docs/decisions-log.md`.
 */

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export const THEME_CHOICES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

export const DEFAULT_THEME: ThemeChoice = 'system';

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEME_CHOICES as readonly string[]).includes(value);
}

/** A cookie value, or anything else, read back as a choice. Never throws. */
export function parseTheme(raw: string | null | undefined): ThemeChoice {
  return isThemeChoice(raw) ? raw : DEFAULT_THEME;
}

/**
 * What to put in `<html data-theme>`, or `undefined` to leave it off.
 *
 * "System" is the *absence* of the attribute, not a third value. `globals.css`
 * declares every colour as `light-dark(light, dark)` against
 * `color-scheme: light dark`, so with no attribute the browser resolves each
 * pair from the OS preference — which is exactly what "system" means. The two
 * pinned cases each set `color-scheme` to one keyword and every token follows.
 * There is no second copy of the palette to keep in step, which is the whole
 * reason the stylesheet was merged.
 */
export function themeAttribute(choice: ThemeChoice): 'light' | 'dark' | undefined {
  return choice === 'system' ? undefined : choice;
}

/**
 * The browser-chrome colour for a pinned theme.
 *
 * These two are the only hard-coded colours outside `globals.css`, and they
 * were already in `layout.tsx` before this file existed — `themeColor` is a
 * meta tag, so it cannot read a CSS custom property. They match `--bg` in each
 * scheme. `tests/prefs.test.ts` pins them to the stylesheet so the pair cannot
 * drift the way two copies of a palette would.
 */
export const THEME_COLOUR = { light: '#f9fafb', dark: '#14161a' } as const;

// ---------------------------------------------------------------------------
// Week start
// ---------------------------------------------------------------------------

export const WEEK_STARTS = ['monday', 'sunday'] as const;
export type WeekStart = (typeof WEEK_STARTS)[number];

/** UK conventions throughout — a settled decision, so Monday is the default. */
export const DEFAULT_WEEK_START: WeekStart = 'monday';

export function parseWeekStart(raw: string | null | undefined): WeekStart {
  return typeof raw === 'string' && (WEEK_STARTS as readonly string[]).includes(raw)
    ? (raw as WeekStart)
    : DEFAULT_WEEK_START;
}

/** Days to subtract from a weekday index (`Date#getUTCDay`, Sunday = 0). */
export function weekStartOffset(weekday: number, start: WeekStart): number {
  return start === 'sunday' ? weekday % 7 : (weekday + 6) % 7;
}

// ---------------------------------------------------------------------------
// Default compose space
// ---------------------------------------------------------------------------

/**
 * The space a new task starts in, when the page has not already picked one.
 *
 * Validated against the spaces the caller can actually *write*, every time it
 * is read, rather than trusted. A cookie naming a space somebody has since been
 * removed from — or never belonged to — resolves to `null` and the compose bar
 * falls back to its first writable space, exactly as it did before this
 * preference existed. Nothing here grants access: the write still goes through
 * `asUser` and the policies still decide. This only chooses between spaces the
 * person already has.
 */
export function resolveDefaultSpace(
  raw: string | null | undefined,
  writableSpaceIds: readonly string[],
): string | null {
  if (typeof raw !== 'string' || raw === '') return null;
  return writableSpaceIds.includes(raw) ? raw : null;
}
