import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { pool } from '@/lib/db';
import { authProviderName, usesDevAuth, type SessionUser } from './session';
import { currentSupabaseUser } from './supabase';

/**
 * Authentication, behind an interface with two implementations.
 *
 * `dev` is a cookie naming a seeded profile. There is no password and no OAuth,
 * because Orbit must run end to end with zero credentials — 637 Vitest tests and
 * every smoke check depend on it. It is the default and it stays the default.
 *
 * `supabase` verifies a real Supabase session server-side and hands the JWT's
 * `sub` to the existing `asUser()`. It is **written, never run**: there is no
 * project and no credential here. See `src/lib/auth/supabase.ts`.
 *
 * Nothing that calls `getCurrentUser()` had to change when the second provider
 * arrived, which is what the interface was for.
 */

export type { SessionUser };
export { authProviderName, usesDevAuth } from './session';

export interface AuthProvider {
  getCurrentUser(): Promise<SessionUser | null>;
  listSelectableUsers(): Promise<SessionUser[]>;
}

const COOKIE = 'orbit_user';

const devProvider: AuthProvider = {
  async getCurrentUser() {
    const jar = await cookies();
    const wanted = jar.get(COOKIE)?.value;

    // These go through orbit.identity_profile/orbit.identity_profiles rather than
    // reading orbit.profiles: the pool role has no table grants at all, by
    // design. See supabase/migrations/0008_identity_lookup.sql.
    //
    // No cookie yet: fall back to the first seeded profile so a fresh clone is
    // demoable without a sign-in step. This is a dev-only affordance.
    if (wanted) {
      const rows = await pool<SessionUser[]>`
        select id, email, display_name as "displayName", timezone
        from orbit.identity_profile(${wanted}::uuid)`;
      if (rows[0]) return rows[0];
    }

    const rows = await pool<SessionUser[]>`
      select id, email, display_name as "displayName", timezone
      from orbit.identity_profiles() limit 1`;
    return rows[0] ?? null;
  },

  async listSelectableUsers() {
    return pool<SessionUser[]>`
      select id, email, display_name as "displayName", timezone
      from orbit.identity_profiles()`;
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
  return provider;
}

export const getCurrentUser = () => authProvider().getCurrentUser();

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
