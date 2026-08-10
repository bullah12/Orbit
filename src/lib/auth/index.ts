import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { pool } from '@/lib/db';
import { authProviderName, devAuthRefusal, usesDevAuth, type SessionUser } from './session';
import { currentSupabaseUser } from './supabase';

/**
 * Authentication, behind an interface with two implementations.
 *
 * `dev` is a cookie naming a seeded profile. There is no password and no OAuth,
 * because Orbit must run end to end with zero credentials — 637 Vitest tests and
 * every smoke check depend on it. It is the default and it stays the default.
 *
 * `supabase` verifies a real Supabase session server-side and hands the JWT's
 * `sub` to the existing `asUser()`. It **runs in production** against a real
 * project. There is still no credential *here*, so no smoke run exercises it —
 * but `tests/auth-gotrue.test.ts` now drives its HTTP layer against a stub, and
 * the app can be run against one too (`docs/STATUS.md`, "Running the app
 * against a stub GoTrue"). See `src/lib/auth/supabase.ts` for which paths have
 * actually been watched, and edge 36 for the one that was watched and failed.
 *
 * Nothing that calls `getCurrentUser()` had to change when the second provider
 * arrived, which is what the interface was for.
 */

export type { SessionUser };
export { authProviderName, devAuthRefusal, usesDevAuth } from './session';

export interface AuthProvider {
  getCurrentUser(): Promise<SessionUser | null>;
  listSelectableUsers(): Promise<SessionUser[]>;
}

const COOKIE = 'orbit_user';

const devProvider: AuthProvider = {
  async getCurrentUser() {
    const jar = await cookies();
    const wanted = jar.get(COOKIE)?.value;

    // These go through app.identity_profile/app.identity_profiles rather than
    // reading orbit.profiles: the pool role has no table grants at all, by
    // design. See supabase/migrations/0008_identity_lookup.sql.
    //
    // No cookie yet: fall back to the first seeded profile so a fresh clone is
    // demoable without a sign-in step. This is a dev-only affordance.
    if (wanted) {
      const rows = await pool<SessionUser[]>`
        select id, email, display_name as "displayName", timezone
        from app.identity_profile(${wanted}::uuid)`;
      if (rows[0]) return rows[0];
    }

    const rows = await pool<SessionUser[]>`
      select id, email, display_name as "displayName", timezone
      from app.identity_profiles() limit 1`;
    return rows[0] ?? null;
  },

  async listSelectableUsers() {
    return pool<SessionUser[]>`
      select id, email, display_name as "displayName", timezone
      from app.identity_profiles()`;
  },
};

/**
 * The Supabase provider offers nobody to become.
 *
 * `listSelectableUsers` is the dev switcher's query and a real provider has no
 * equivalent — becoming somebody else is not a feature, it is the thing real
 * accounts exist to stop. It returns an empty list rather than throwing, and
 * the sidebar renders no switcher for an empty list.
 */
const supabaseProvider: AuthProvider = {
  getCurrentUser: currentSupabaseUser,
  async listSelectableUsers() {
    return [];
  },
};

const providers: Record<string, AuthProvider> = {
  dev: devProvider,
  supabase: supabaseProvider,
};

export function authProvider(): AuthProvider {
  const name = authProviderName();
  const provider = providers[name];
  if (!provider) {
    throw new Error(
      `Unknown AUTH_PROVIDER: ${name}. Known providers: ${Object.keys(providers).join(', ')}.`,
    );
  }

  // Edge 22, enforced rather than warned about. Thrown here rather than only
  // checked in the layout, because the layout is not the only way in: a server
  // action, a route handler and `requireUser()` all arrive through this
  // function, and a guard that only guards the page somebody looks at is not a
  // guard. `devAuthRefusal` explains the whole rule.
  const refusal = devAuthRefusal();
  if (refusal) throw new Error(refusal);

  return provider;
}

/**
 * Who is asking — resolved once per request, however many callers ask.
 *
 * `cache()` is memoisation for the lifetime of one request and nothing wider:
 * React gives each request its own store, so this can never hand one person's
 * identity to another's request. It is not an optimisation that was guessed at.
 * The root layout resolves identity and so does every page under it, so a plain
 * function meant **two** identity resolutions per render — under `supabase`,
 * two round trips to GoTrue plus two `app.identity_profile` queries, on every
 * page anybody opened.
 *
 * Watched, against a stub GoTrue: a signed-in page load made two `GET /user`
 * calls before this and makes one after. Worse than the cost, the duplicate
 * landed *inside* the refresh path — the second call re-presented a refresh
 * token the first had already spent, burning Supabase's 10-second reuse grace
 * at an age of 0.0 seconds, on the very request that created it. That grace
 * exists precisely for server-rendered apps, and Orbit was spending it on
 * itself. Edge 36 is still edge 36; this stops making it worse.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> =>
  authProvider().getCurrentUser(),
);

/**
 * Who you could become. Empty unless the dev provider is live — the switcher is
 * impersonation by design and must be unreachable when identity means something.
 */
export const listSelectableUsers = async (): Promise<SessionUser[]> =>
  usesDevAuth() ? devProvider.listSelectableUsers() : [];

/**
 * Pages call this.
 *
 * Under `dev` it throws, because no profile means no seeded database and the
 * message names the command that fixes it. Under a real provider it redirects
 * to the sign-in page, because no session is an ordinary state somebody can get
 * out of by signing in.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (user) return user;

  if (!usesDevAuth()) redirect('/auth/signin');

  throw new Error(
    'No profile found. Run ./scripts/db-reset.sh to create and seed the database.',
  );
}

export const USER_COOKIE = COOKIE;
