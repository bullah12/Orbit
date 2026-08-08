import 'server-only';
import { cookies } from 'next/headers';

import {
  DEFAULT_THEME,
  type ThemeChoice,
  type WeekStart,
  parseTheme,
  parseWeekStart,
} from './index';

/**
 * Reading and writing the preference cookies.
 *
 * The same shape as `src/lib/sync/device.ts`: unsigned, `httpOnly: false`,
 * long-lived, and carrying no permission whatsoever. A forged value can make
 * somebody's own browser render dark, start the week on Sunday, or prefer a
 * space they can already write to. None of the three is a capability, which is
 * why none of them is signed — `AUTH_COOKIE_SECRET` still signs nothing, and
 * these are not the cookies that would change that.
 *
 * `orbit_space` in particular is validated against the caller's *writable*
 * spaces on every read (`resolveDefaultSpace`), so the cookie is a hint about
 * which of your own spaces to prefer and never an assertion that you have one.
 */

export const THEME_COOKIE = 'orbit_theme';
export const WEEK_START_COOKIE = 'orbit_week_start';
export const DEFAULT_SPACE_COOKIE = 'orbit_space';

const A_YEAR = 60 * 60 * 24 * 365;

export async function readTheme(): Promise<ThemeChoice> {
  return parseTheme((await cookies()).get(THEME_COOKIE)?.value);
}

export async function readWeekStart(): Promise<WeekStart> {
  return parseWeekStart((await cookies()).get(WEEK_START_COOKIE)?.value);
}

/** Raw, because only the caller knows which spaces are writable. */
export async function readDefaultSpaceRaw(): Promise<string | null> {
  return (await cookies()).get(DEFAULT_SPACE_COOKIE)?.value ?? null;
}

async function put(name: string, value: string): Promise<void> {
  const jar = await cookies();
  jar.set(name, value, { path: '/', httpOnly: false, sameSite: 'lax', maxAge: A_YEAR });
}

async function drop(name: string): Promise<void> {
  (await cookies()).delete(name);
}

/**
 * "System" deletes the cookie rather than storing the word.
 *
 * A person who has never chosen and a person who has chosen "follow my OS"
 * want identical behaviour, so they should be the same state rather than two
 * states that have to be kept behaving alike.
 */
export async function writeTheme(choice: ThemeChoice): Promise<void> {
  if (choice === DEFAULT_THEME) await drop(THEME_COOKIE);
  else await put(THEME_COOKIE, choice);
}

export async function writeWeekStart(start: WeekStart): Promise<void> {
  await put(WEEK_START_COOKIE, start);
}

/** An empty id means "no preference", and clears the cookie. */
export async function writeDefaultSpace(spaceId: string): Promise<void> {
  if (spaceId === '') await drop(DEFAULT_SPACE_COOKIE);
  else await put(DEFAULT_SPACE_COOKIE, spaceId);
}
