import 'server-only';
import { cookies } from 'next/headers';
import { pool } from '@/lib/db';
import {
  accessTokenExpired,
  displayNameFrom,
  parseTokenResponse,
  subjectOf,
  supabaseErrorSentence,
  type SessionUser,
  type SupabaseSession,
} from './session';

/**
 * Supabase Auth, written against the published GoTrue REST API.
 *
 * **Running in production. Executed against a stub, never against the project.**
 * Orbit is deployed against a real Supabase project and this provider is what
 * serves it; signing in has run, and it is how two of session 13's bugs were
 * reported.
 *
 * Session 15 pointed `SUPABASE_URL` at a stub GoTrue and ran the HTTP layer for
 * the first time — `tests/auth-gotrue.test.ts`. That found two bugs nobody
 * could see by reading: `redirect_to` was being sent somewhere GoTrue does not
 * read, so every magic link went to the wrong place, and an unreachable project
 * threw instead of refusing. Both are fixed and pinned by that file.
 *
 * **A stub is not the project.** What still nobody has watched, against real
 * Supabase: a magic link arriving in a real inbox, a sign-up with email
 * confirmation on, and `refreshSession` against a server that genuinely rotates
 * and genuinely revokes. The last one has a known bug that a stub cannot show —
 * see `currentSupabaseUser` and edge 36. Do not read "tested" here as more than
 * "the requests are the right shape".
 *
 * Three things this provider deliberately does not do:
 *
 *   * **No service-role client.** The only thing it establishes is *who* the
 *     caller is; the id then goes to the existing `asUser()` and every policy
 *     decides the rest. A service-role key here would be a second, unpoliced
 *     way to read the database.
 *   * **No SDK.** Same call as every other real provider in this repo: a
 *     dependency Orbit cannot execute is a dependency nobody can check. The
 *     endpoints used are `/token`, `/signup`, `/otp`, `/verify`, `/user` and
 *     `/logout`.
 *   * **No local JWT verification.** Verifying a signature needs either the
 *     project's JWT secret or its JWKS, and a wrong answer there is a silent
 *     authentication bypass. `GET /auth/v1/user` asks the issuer, which is the
 *     one party that cannot be wrong about it.
 *
 * Credentials are read when the provider is *called*, never at import, so the
 * app still boots and renders with zero credentials whatever AUTH_PROVIDER says.
 */

export const ACCESS_COOKIE = 'orbit_sb_access';
export const REFRESH_COOKIE = 'orbit_sb_refresh';

/** Thrown when the provider is selected but not configured. */
export class SupabaseAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseAuthError';
  }
}

type Config = { url: string; anonKey: string };

function config(): Config {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, '') ?? '';
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim() ?? '';
  if (!url || !anonKey) {
    throw new SupabaseAuthError(
      'AUTH_PROVIDER=supabase needs SUPABASE_URL and SUPABASE_ANON_KEY. Neither is set, so there is no project to sign in to.',
    );
  }
  return { url, anonKey };
}

/** Is the provider configured? Used by the sign-in page to say so plainly. */
export function supabaseIsConfigured(): boolean {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}

/**
 * One call to GoTrue.
 *
 * `redirectTo` is a *query* parameter and not a body field, which is not a
 * detail: GoTrue reads the address it should send somebody back to from
 * `?redirect_to=` and from nowhere else. Sending it in the body — which this
 * did, as `options.email_redirect_to`, copying the shape supabase-js takes from
 * its *caller* rather than the shape it puts on the wire — is silently ignored,
 * so every magic link and every confirmation email went to the project's Site
 * URL instead of `/auth/callback`. Nothing fails when that happens; the link
 * simply lands somewhere that cannot finish signing anybody in.
 *
 * A transport failure comes back as a refusal rather than an exception. Every
 * caller is a server action that renders `{ok:false}` as a sentence on the
 * sign-in page, and a throw instead escapes to the generic error page — which
 * says Orbit cannot reach its *database* and names the wrong thing entirely.
 */
async function gotrue(
  path: string,
  init: {
    method: 'GET' | 'POST';
    body?: unknown;
    accessToken?: string;
    redirectTo?: string;
  },
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const { url, anonKey } = config();
  const target = new URL(`${url}/auth/v1${path}`);
  if (init.redirectTo) target.searchParams.set('redirect_to', init.redirectTo);

  let res: Response;
  try {
    res = await fetch(target, {
      method: init.method,
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${init.accessToken ?? anonKey}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });
  } catch {
    // Deliberately not the underlying message: it is a Node internal
    // ("fetch failed", "bad port") and says nothing anybody can act on.
    return {
      ok: false,
      status: 0,
      body: {
        message:
          'Supabase could not be reached. The project may be paused, or this server may have no route to it.',
      },
    };
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text.slice(0, 300) };
  }
  return { ok: res.ok, status: res.status, body };
}

export type AuthResult<T> = { ok: true; value: T } | { ok: false; error: string };

function failed(status: number, body: unknown): { ok: false; error: string } {
  return { ok: false, error: supabaseErrorSentence(status, body) };
}

// ---------------------------------------------------------------------------
// The operations the sign-in, sign-up and callback screens perform
// ---------------------------------------------------------------------------

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<AuthResult<SupabaseSession>> {
  const res = await gotrue('/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  });
  if (!res.ok) return failed(res.status, res.body);
  const session = parseTokenResponse(res.body);
  return 'error' in session ? { ok: false, error: session.error } : { ok: true, value: session };
}

/**
 * Sign up with a password.
 *
 * Whether a session comes back depends on a project setting nobody here can
 * see: with email confirmation on, GoTrue answers with a user and no session,
 * and the account is not usable until the link is clicked. Both answers are
 * returned honestly rather than one being reported as the other.
 */
export async function signUpWithPassword(
  email: string,
  password: string,
  displayName: string,
  redirectTo: string,
): Promise<AuthResult<{ session: SupabaseSession | null; confirmationRequired: boolean }>> {
  const res = await gotrue('/signup', {
    method: 'POST',
    redirectTo,
    body: {
      email,
      password,
      data: { display_name: displayName },
      gotrue_meta_security: {},
    },
  });
  if (!res.ok) return failed(res.status, res.body);

  const session = parseTokenResponse(res.body);
  if ('error' in session) {
    return { ok: true, value: { session: null, confirmationRequired: true } };
  }
  return { ok: true, value: { session, confirmationRequired: false } };
}

/** A magic link. `create_user: false` so this cannot be a back door to sign-up. */
export async function sendMagicLink(
  email: string,
  redirectTo: string,
): Promise<AuthResult<null>> {
  const res = await gotrue('/otp', {
    method: 'POST',
    redirectTo,
    body: { email, create_user: false, gotrue_meta_security: {} },
  });
  return res.ok ? { ok: true, value: null } : failed(res.status, res.body);
}

/**
 * Finish a magic link that arrived as a `token_hash`.
 *
 * This is the flow a project gets when its email template uses `{{ .TokenHash }}`.
 * The other flow — the default `{{ .ConfirmationURL }}` — lands on the callback
 * with the tokens in the URL *fragment*, which never reaches a server; that one
 * is handled by `sessionFromTokens` below, called from the callback screen.
 */
export async function verifyEmailToken(
  tokenHash: string,
  type: string,
): Promise<AuthResult<SupabaseSession>> {
  const res = await gotrue('/verify', {
    method: 'POST',
    body: { token_hash: tokenHash, type },
  });
  if (!res.ok) return failed(res.status, res.body);
  const session = parseTokenResponse(res.body);
  return 'error' in session ? { ok: false, error: session.error } : { ok: true, value: session };
}

/**
 * Turn a pair of tokens into a session, by asking Supabase who they belong to.
 *
 * The tokens arrive from the browser, so they are a claim and not a fact until
 * the issuer confirms them. `GET /auth/v1/user` is that confirmation.
 */
export async function sessionFromTokens(
  accessToken: string,
  refreshToken: string,
): Promise<AuthResult<SupabaseSession>> {
  const res = await gotrue('/user', { method: 'GET', accessToken });
  if (!res.ok) return failed(res.status, res.body);
  const user = (res.body ?? {}) as Record<string, unknown>;
  const id = typeof user.id === 'string' ? user.id : subjectOf(accessToken);
  if (!id) return { ok: false, error: 'That link did not identify anybody.' };
  const email = typeof user.email === 'string' ? user.email : '';
  return {
    ok: true,
    value: {
      accessToken,
      refreshToken,
      userId: id,
      email,
      displayName: displayNameFrom(
        (user.user_metadata ?? null) as Record<string, unknown> | null,
        email,
      ),
    },
  };
}

/**
 * Trade a refresh token for a new session.
 *
 * Exported so it can be driven from a test. GoTrue **rotates**: the answer
 * carries a *new* refresh token and the one just spent stops working once the
 * reuse interval passes. Whoever calls this owns storing what comes back — see
 * the note on `currentSupabaseUser`, which is where that goes wrong.
 */
export async function refreshSession(refreshToken: string): Promise<AuthResult<SupabaseSession>> {
  const res = await gotrue('/token?grant_type=refresh_token', {
    method: 'POST',
    body: { refresh_token: refreshToken },
  });
  if (!res.ok) return failed(res.status, res.body);
  const session = parseTokenResponse(res.body);
  return 'error' in session ? { ok: false, error: session.error } : { ok: true, value: session };
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

/**
 * Both cookies are httpOnly: an access token readable by script is a token one
 * XSS away from being somebody else's session. `secure` follows NODE_ENV so a
 * local HTTP run still works — a deployment is HTTPS or it is misconfigured.
 */
export async function persistSession(session: SupabaseSession): Promise<void> {
  const jar = await cookies();
  const options = {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  };
  jar.set(ACCESS_COOKIE, session.accessToken, options);
  if (session.refreshToken) jar.set(REFRESH_COOKIE, session.refreshToken, options);
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}

/** Tell Supabase the session is over too, then forget it here whatever it said. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const accessToken = jar.get(ACCESS_COOKIE)?.value;
  if (accessToken) {
    try {
      await gotrue('/logout', { method: 'POST', accessToken, body: {} });
    } catch {
      // A sign-out that fails because Supabase is unreachable must still sign
      // you out of this app. The cookies are the session as far as Orbit is
      // concerned, and they are about to go.
    }
  }
  await clearSession();
}

// ---------------------------------------------------------------------------
// The provider itself
// ---------------------------------------------------------------------------

/**
 * The profile row for a verified subject.
 *
 * Read through `app.identity_profile`, the same narrow SECURITY DEFINER
 * function the dev provider uses — the pool role holds no table grants at all
 * and this does not change that. The row exists because migration 0012 puts one
 * there when the auth user is created; if it is missing (an account created
 * before that migration ran) the JWT's own claims are used, so the app renders
 * and says who you are rather than failing.
 */
async function profileFor(session: SupabaseSession): Promise<SessionUser> {
  const rows = await pool<SessionUser[]>`
    select id, email, display_name as "displayName", timezone
    from app.identity_profile(${session.userId}::uuid)`;
  return (
    rows[0] ?? {
      id: session.userId,
      email: session.email,
      displayName: session.displayName,
      timezone: 'Europe/London',
    }
  );
}

export async function currentSupabaseUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const accessToken = jar.get(ACCESS_COOKIE)?.value ?? '';
  const refreshToken = jar.get(REFRESH_COOKIE)?.value ?? '';
  if (!accessToken && !refreshToken) return null;

  let session: SupabaseSession | null = null;

  if (accessToken && !accessTokenExpired(accessToken)) {
    const verified = await sessionFromTokens(accessToken, refreshToken);
    if (verified.ok) session = verified.value;
  }

  if (!session && refreshToken) {
    const refreshed = await refreshSession(refreshToken);
    if (refreshed.ok) {
      session = refreshed.value;
      // KNOWN BROKEN — edge 36, argued in docs/decisions-log.md (session 15).
      //
      // This said "the next server action persists it; until then the refresh
      // token still works", and that is wrong. GoTrue **rotates**: the token
      // just spent is revoked once the reuse interval lapses (10s by default),
      // and presenting it again is read as theft — Supabase then revokes the
      // entire token family. A Server Component cannot write cookies, so on a
      // page render this `persistSession` always throws and the rotated token
      // is dropped. The cookie still holds the spent one.
      //
      // So the first page load after the access token expires renders; the
      // next one ~10s later refreshes with the same spent token, is refused,
      // and the session is dead beyond recovery. The fix belongs in a context
      // that can write cookies — middleware — and is not made here because it
      // cannot be tested against a real project from this repository.
      try {
        await persistSession(session);
      } catch {
        /* not a cookie-writing context */
      }
    }
  }

  if (!session) return null;
  return profileFor(session);
}
