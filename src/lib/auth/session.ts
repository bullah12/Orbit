/**
 * The parts of authentication that are decisions rather than I/O.
 *
 * Deliberately free of `server-only`, a database handle and `next/headers`, so
 * every rule in here is reachable from Vitest. The two providers in
 * `src/lib/auth/index.ts` do the talking; this file decides what an answer
 * means.
 */

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
};

/** The value of AUTH_PROVIDER, normalised. Unknown values fail at selection. */
export function authProviderName(env: NodeJS.ProcessEnv = process.env): string {
  return env.AUTH_PROVIDER?.trim() || 'dev';
}

/**
 * Is the dev cookie-switcher the live provider?
 *
 * This is the single question behind "hide the user switcher": `switchUser` is
 * impersonation by design, so it must be unreachable the moment identity means
 * something. It is a function rather than a constant because
 * `process.env.AUTH_PROVIDER` is read per request in a long-lived server.
 */
export function usesDevAuth(env: NodeJS.ProcessEnv = process.env): boolean {
  return authProviderName(env) === 'dev';
}

/**
 * The name of the escape hatch that lets dev auth run a production build.
 *
 * Set by `pnpm start` and by nothing else — deliberately not by the Dockerfile,
 * which is the whole point. See {@link devAuthRefusal}.
 */
export const ALLOW_DEV_AUTH_ENV = 'ORBIT_ALLOW_DEV_AUTH';

/**
 * Why dev auth must not run here, or null if it may — edge 22, enforced.
 *
 * `switchUser` is impersonation by design: with `AUTH_PROVIDER=dev` the sidebar
 * offers a list of accounts and becoming any of them is one click. That is
 * exactly right in a container with three seeded profiles and no credentials,
 * and it is a total compromise on a public URL. Until now the only thing
 * standing between the two was a sentence in `docs/deploy.md` saying "do not",
 * and **`dev` is the default**, so the dangerous case is not even a typo — it is
 * forgetting to set a variable at all.
 *
 * The signal is `NODE_ENV=production`, which the Dockerfile sets and which
 * every hosting platform sets. But that alone would break the thing this
 * repository guarantees: `pnpm start` is a production build, `pnpm smoke`
 * drives it, and both must keep running with zero credentials. So there is one
 * escape hatch, and where it is set is the design:
 *
 *   - `pnpm start` sets `ORBIT_ALLOW_DEV_AUTH=1`, so the local production run
 *     and the smoke suite are unaffected.
 *   - **The Dockerfile does not**, and it runs `node server.js` rather than
 *     `pnpm start`, so nothing in `package.json` can leak into an image.
 *
 * A deployment therefore has to set it *on purpose*, in the same place it sets
 * its database URL, having read a variable named `ORBIT_ALLOW_DEV_AUTH`. That
 * is a decision somebody made rather than one they defaulted into.
 *
 * Pure and env-injectable so the whole matrix is tested without a server.
 */
export function devAuthRefusal(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!usesDevAuth(env)) return null;
  if (env.NODE_ENV !== 'production') return null;
  if (env[ALLOW_DEV_AUTH_ENV] === '1') return null;

  const how = env.AUTH_PROVIDER?.trim()
    ? 'AUTH_PROVIDER is set to `dev`'
    : 'AUTH_PROVIDER is unset, and `dev` is the default';

  return (
    `Refusing to start: ${how}, in a production build. ` +
    'The dev provider is a cookie naming a seeded profile — it has no password ' +
    'and the sidebar offers a switcher, so anybody who can reach this URL can ' +
    'become anybody. Set AUTH_PROVIDER=supabase and the SUPABASE_URL / ' +
    'SUPABASE_ANON_KEY it needs. If you genuinely want the dev provider on a ' +
    `production build — a local \`pnpm start\`, a demo nobody can reach — set ${ALLOW_DEV_AUTH_ENV}=1.`
  );
}

/**
 * The payload of a JWT, without verifying it.
 *
 * Verification happens at Supabase — `getCurrentUser()` asks GoTrue who the
 * token belongs to rather than trusting anything read here. This exists to
 * answer cheap questions about a token we already hold: when does it expire,
 * and is it even shaped like a JWT. Nothing security-bearing may be read from
 * it, and the name says so.
 */
export function decodeJwtPayloadUnverified(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8',
    );
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Is this access token past its `exp`, with a margin?
 *
 * The margin exists because a token that expires in two seconds will expire
 * mid-request. A token we cannot read at all counts as expired: the refresh
 * path is the safe answer, not "assume it is fine".
 */
export function accessTokenExpired(token: string, now = Date.now(), skewSeconds = 30): boolean {
  const payload = decodeJwtPayloadUnverified(token);
  const exp = payload?.exp;
  if (typeof exp !== 'number') return true;
  return exp * 1000 - skewSeconds * 1000 <= now;
}

/** The `sub` claim, which is the id every policy in Orbit keys off. */
export function subjectOf(token: string): string | null {
  const sub = decodeJwtPayloadUnverified(token)?.sub;
  return typeof sub === 'string' && sub.length > 0 ? sub : null;
}

/**
 * A display name for somebody who has only just signed up.
 *
 * Supabase carries whatever the sign-up form put in `user_metadata`; the email
 * local part is the fallback, because a profile row with an empty display name
 * would render as a blank in every row that names an owner. The same order is
 * implemented in SQL in migration 0012 — change both together, and the pgTAP
 * assertions on the trigger are what catch it if you do not.
 */
export function displayNameFrom(
  metadata: Record<string, unknown> | null | undefined,
  email: string,
): string {
  for (const key of ['display_name', 'displayName', 'full_name', 'name']) {
    const value = metadata?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 120);
  }
  const local = email.split('@')[0]?.trim();
  return local && local.length > 0 ? local.slice(0, 120) : email;
}

/** What Supabase's REST API hands back for a session. */
export type SupabaseSession = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  displayName: string;
};

/**
 * Read a GoTrue token response into a session, or say why it is not one.
 *
 * Written as a parser rather than a cast because every field here is used to
 * decide who somebody is: an `access_token` that is not a string, or a token
 * with no `sub`, must be a refusal and not `undefined` flowing onwards.
 */
export function parseTokenResponse(body: unknown): SupabaseSession | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Supabase returned no session.' };
  const b = body as Record<string, unknown>;
  const accessToken = typeof b.access_token === 'string' ? b.access_token : '';
  const refreshToken = typeof b.refresh_token === 'string' ? b.refresh_token : '';
  if (!accessToken) return { error: 'Supabase returned no access token.' };

  const user = (b.user ?? null) as Record<string, unknown> | null;
  const id = typeof user?.id === 'string' ? user.id : subjectOf(accessToken);
  if (!id) return { error: 'Supabase returned a token with no subject.' };

  const email = typeof user?.email === 'string' ? user.email : '';
  const metadata = (user?.user_metadata ?? null) as Record<string, unknown> | null;

  return {
    accessToken,
    refreshToken,
    userId: id,
    email,
    displayName: displayNameFrom(metadata, email),
  };
}

/**
 * The sentence a failed GoTrue call turns into.
 *
 * Supabase answers with `error_description`, `msg` or `message` depending on
 * the endpoint and the version. A screen that says "Error" and a status code is
 * a screen nobody can act on, so all three are tried and there is a plain
 * fallback naming the status.
 */
export function supabaseErrorSentence(status: number, body: unknown): string {
  const b = (body ?? {}) as Record<string, unknown>;
  for (const key of ['error_description', 'msg', 'message', 'error']) {
    const value = b[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  if (status === 400 || status === 401) return 'Those details were not accepted.';
  if (status === 422) return 'Supabase refused those details.';
  if (status === 429) return 'Too many attempts. Wait a minute and try again.';
  return `Supabase answered ${status}.`;
}

/**
 * Is this a safe place to send somebody after signing in?
 *
 * Only an in-app path. The same rule the push provider applies to a
 * notification link, and for the same reason: a redirect target that can be an
 * absolute URL is an open redirect, and a sign-in page is exactly where one is
 * worth having.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value) return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.includes('\\')) return '/';
  return value;
}
