import 'server-only';
import { cookies } from 'next/headers';
import { pool } from '@/lib/db';

/**
 * Authentication, behind an interface with exactly one implementation.
 *
 * `dev` is a cookie naming a seeded profile. There is no password and no OAuth,
 * because Orbit must run end to end with zero credentials. When a real provider
 * arrives it implements `AuthProvider` and is selected by AUTH_PROVIDER; nothing
 * that calls getCurrentUser() has to change.
 */

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
};

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
    // reading public.profiles: the pool role has no table grants at all, by
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

const providers: Record<string, AuthProvider> = { dev: devProvider };

export function authProvider(): AuthProvider {
  const name = process.env.AUTH_PROVIDER ?? 'dev';
  const provider = providers[name];
  if (!provider) throw new Error(`Unknown AUTH_PROVIDER: ${name}`);
  return provider;
}

export const getCurrentUser = () => authProvider().getCurrentUser();
export const listSelectableUsers = () => authProvider().listSelectableUsers();

/** Pages call this; it throws rather than rendering a page with no identity. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error(
      'No profile found. Run ./scripts/db-reset.sh to create and seed the database.',
    );
  }
  return user;
}

export const USER_COOKIE = COOKIE;
