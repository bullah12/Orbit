import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  refreshSession,
  sendMagicLink,
  sessionFromTokens,
  signInWithPassword,
  signUpWithPassword,
  supabaseIsConfigured,
  verifyEmailToken,
} from '@/lib/auth/supabase';

/**
 * The Supabase provider's HTTP layer, actually executed.
 *
 * Every other test of `src/lib/auth/` covers `session.ts` — the decisions taken
 * once an answer has arrived. Nothing had ever run the half that *asks*, and
 * `docs/STATUS.md` named the refresh path for four sessions as the part most
 * likely to be wrong. It was right twice over: this file is what found both.
 *
 * The stub is a real HTTP server speaking GoTrue's REST shapes, so what is under
 * test is the request Orbit genuinely puts on the wire — method, path, **query
 * string**, headers and body — and not a mock's opinion of it. That distinction
 * is the whole point here: the `redirect_to` bug below is invisible to any test
 * that asserts on arguments rather than on the request.
 *
 * What this still is not: proof against a real project. A stub answers how the
 * documentation says GoTrue answers. Rotation-on-reuse, rate limits and the
 * confirmation-on shape are modelled from Supabase's own docs, not observed.
 */

type Recorded = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
};

let server: Server;
let seen: Recorded[] = [];
/** What the next request to each path gets back. */
let replies: Record<string, { status: number; body: unknown }> = {};

function reply(path: string, status: number, body: unknown) {
  replies[path] = { status, body };
}

/** A JWT with the given payload, signed with nothing. Never verified. */
function jwt(payload: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(payload)}.not-a-signature`;
}

const USER_ID = '11111111-1111-4111-8111-111111111111';
const future = () => Math.floor(Date.now() / 1000) + 3600;

/** GoTrue's session shape, as `POST /token` and `POST /verify` return it. */
function sessionBody(overrides: Record<string, unknown> = {}) {
  return {
    access_token: jwt({ sub: USER_ID, exp: future() }),
    refresh_token: 'refresh-1',
    token_type: 'bearer',
    expires_in: 3600,
    user: {
      id: USER_ID,
      email: 'kit@example.com',
      user_metadata: { display_name: 'Kit Fairweather' },
    },
    ...overrides,
  };
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: Record<string, unknown> | null = null;
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      } catch {
        body = { unparsed: raw };
      }
      seen.push({
        method: req.method ?? '',
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers as Record<string, string>,
        body,
      });

      const canned = replies[url.pathname];
      res.writeHead(canned?.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(canned?.body ?? sessionBody()));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  process.env.SUPABASE_URL = `http://127.0.0.1:${port}`;
  process.env.SUPABASE_ANON_KEY = 'anon-key-for-the-stub';
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seen = [];
  replies = {};
});

const only = () => {
  expect(seen).toHaveLength(1);
  return seen[0];
};

describe('the provider is pointed at a project', () => {
  it('reads its credentials when called, so the stub is what it talks to', () => {
    expect(supabaseIsConfigured()).toBe(true);
  });
});

describe('signing in with a password', () => {
  it('posts to /token?grant_type=password and carries the anon key', async () => {
    const result = await signInWithPassword('kit@example.com', 'a-real-password');

    const req = only();
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/auth/v1/token');
    expect(req.query.get('grant_type')).toBe('password');
    expect(req.body).toEqual({ email: 'kit@example.com', password: 'a-real-password' });
    expect(req.headers.apikey).toBe('anon-key-for-the-stub');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.userId).toBe(USER_ID);
      expect(result.value.displayName).toBe('Kit Fairweather');
    }
  });

  it('turns a refusal into a sentence rather than a status code', async () => {
    reply('/auth/v1/token', 400, {
      error: 'invalid_grant',
      error_description: 'Invalid login credentials',
    });

    const result = await signInWithPassword('kit@example.com', 'wrong');
    expect(result).toEqual({ ok: false, error: 'Invalid login credentials' });
  });
});

describe('the refresh path — executed here for the first time', () => {
  it('posts the refresh token to /token?grant_type=refresh_token', async () => {
    const result = await refreshSession('refresh-1');

    const req = only();
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/auth/v1/token');
    expect(req.query.get('grant_type')).toBe('refresh_token');
    expect(req.body).toEqual({ refresh_token: 'refresh-1' });

    expect(result.ok).toBe(true);
  });

  it('carries the ROTATED refresh token out, which is the value that must be stored', async () => {
    // GoTrue rotates on every refresh: the answer holds a *new* refresh token
    // and the spent one dies once the reuse interval lapses. A caller that
    // keeps only the access token has a session with one refresh left in it.
    reply('/auth/v1/token', 200, sessionBody({ refresh_token: 'refresh-2' }));

    const result = await refreshSession('refresh-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.refreshToken).toBe('refresh-2');
      expect(result.value.refreshToken).not.toBe('refresh-1');
    }
  });

  it('says what Supabase said when a spent token is presented again', async () => {
    // The answer to reusing a rotated token outside the 10s reuse interval.
    // Supabase treats it as theft: the whole family is revoked, so this is
    // terminal and the sentence is what somebody sees.
    reply('/auth/v1/token', 400, {
      error: 'invalid_grant',
      error_description: 'Invalid Refresh Token: Already Used',
    });

    const result = await refreshSession('refresh-1');
    expect(result).toEqual({ ok: false, error: 'Invalid Refresh Token: Already Used' });
  });

  it('refuses a token response with no subject rather than inventing one', async () => {
    reply('/auth/v1/token', 200, { access_token: 'not-a-jwt', refresh_token: 'r' });
    const result = await refreshSession('refresh-1');
    expect(result).toEqual({ ok: false, error: 'Supabase returned a token with no subject.' });
  });
});

describe('a magic link', () => {
  it('sends redirect_to in the QUERY STRING, which is the only place GoTrue reads it', async () => {
    // The bug this file was written to catch. GoTrue takes the redirect target
    // as a `redirect_to` query parameter — supabase-js puts it there and the
    // server reads it nowhere else. Orbit sent it as `options.email_redirect_to`
    // in the JSON body, which GoTrue does not read, so the target was computed,
    // passed down and silently dropped: every link went to the project's Site
    // URL instead of `/auth/callback`, and `?next=` was lost with it.
    const result = await sendMagicLink('kit@example.com', 'https://orbit.example/auth/callback?next=%2Fspaces');

    const req = only();
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/auth/v1/otp');
    expect(req.query.get('redirect_to')).toBe('https://orbit.example/auth/callback?next=%2Fspaces');
    expect(result.ok).toBe(true);
  });

  it('asks GoTrue not to create an account, so a link cannot be a back door to sign-up', async () => {
    await sendMagicLink('stranger@example.com', 'https://orbit.example/auth/callback');
    expect(only().body).toMatchObject({ create_user: false });
  });

  it('does not put the redirect anywhere GoTrue ignores', async () => {
    await sendMagicLink('kit@example.com', 'https://orbit.example/auth/callback');
    const body = only().body ?? {};
    expect(body).not.toHaveProperty('options');
    expect(body).not.toHaveProperty('email_redirect_to');
  });

  it('turns a rate limit into a sentence', async () => {
    reply('/auth/v1/otp', 429, { message: 'For security purposes, you can only request this after 51 seconds.' });
    const result = await sendMagicLink('kit@example.com', 'https://orbit.example/auth/callback');
    expect(result).toEqual({
      ok: false,
      error: 'For security purposes, you can only request this after 51 seconds.',
    });
  });
});

describe('signing up', () => {
  it('sends redirect_to in the query string here too — the confirmation email uses it', async () => {
    reply('/auth/v1/signup', 200, sessionBody());
    await signUpWithPassword('kit@example.com', 'a-real-password', 'Kit', 'https://orbit.example/auth/callback');

    const req = only();
    expect(req.path).toBe('/auth/v1/signup');
    expect(req.query.get('redirect_to')).toBe('https://orbit.example/auth/callback');
    expect(req.body).toMatchObject({
      email: 'kit@example.com',
      data: { display_name: 'Kit' },
    });
  });

  it('reports confirmation-required honestly when GoTrue returns a user and no session', async () => {
    // What a project with "Confirm email" on answers: the user exists, and
    // there is no session until the link in the email is followed.
    reply('/auth/v1/signup', 200, {
      id: USER_ID,
      email: 'kit@example.com',
      confirmation_sent_at: new Date().toISOString(),
      user_metadata: { display_name: 'Kit' },
    });

    const result = await signUpWithPassword('kit@example.com', 'pw', 'Kit', 'https://orbit.example/auth/callback');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.confirmationRequired).toBe(true);
      expect(result.value.session).toBeNull();
    }
  });

  it('hands back a usable session when confirmation is off', async () => {
    reply('/auth/v1/signup', 200, sessionBody());
    const result = await signUpWithPassword('kit@example.com', 'pw', 'Kit', 'https://orbit.example/auth/callback');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.confirmationRequired).toBe(false);
      expect(result.value.session?.userId).toBe(USER_ID);
    }
  });

  it('says so when the address is already taken', async () => {
    reply('/auth/v1/signup', 422, { msg: 'User already registered' });
    const result = await signUpWithPassword('kit@example.com', 'pw', 'Kit', 'https://orbit.example/auth/callback');
    expect(result).toEqual({ ok: false, error: 'User already registered' });
  });
});

describe('finishing a link', () => {
  it('verifies a token_hash at /verify', async () => {
    reply('/auth/v1/verify', 200, sessionBody());
    const result = await verifyEmailToken('a-token-hash', 'magiclink');

    const req = only();
    expect(req.path).toBe('/auth/v1/verify');
    expect(req.body).toEqual({ token_hash: 'a-token-hash', type: 'magiclink' });
    expect(result.ok).toBe(true);
  });

  it('says what Supabase said when a link has expired', async () => {
    reply('/auth/v1/verify', 401, { msg: 'Token has expired or is invalid' });
    const result = await verifyEmailToken('stale', 'magiclink');
    expect(result).toEqual({ ok: false, error: 'Token has expired or is invalid' });
  });

  it('asks the issuer who a pair of fragment tokens belongs to, with the token as the bearer', async () => {
    const access = jwt({ sub: USER_ID, exp: future() });
    reply('/auth/v1/user', 200, {
      id: USER_ID,
      email: 'kit@example.com',
      user_metadata: { display_name: 'Kit Fairweather' },
    });

    const result = await sessionFromTokens(access, 'refresh-1');

    const req = only();
    expect(req.method).toBe('GET');
    expect(req.path).toBe('/auth/v1/user');
    // Not the anon key: the whole point is asking on behalf of this token.
    expect(req.headers.authorization).toBe(`Bearer ${access}`);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.userId).toBe(USER_ID);
  });

  it('refuses tokens the issuer does not recognise', async () => {
    reply('/auth/v1/user', 401, { msg: 'invalid claim: missing sub claim' });
    const result = await sessionFromTokens(jwt({ sub: USER_ID, exp: future() }), 'r');
    expect(result).toEqual({ ok: false, error: 'invalid claim: missing sub claim' });
  });
});

describe('when the project cannot be reached at all', () => {
  it('comes back with a sentence instead of throwing into a 500', async () => {
    // A DNS failure, a paused project, a network partition. Every caller of
    // this provider is a server action that turns `{ok:false}` into a sentence
    // on the sign-in page; an exception instead escapes to the error page,
    // which says "Orbit can't reach its database" and names the wrong thing.
    const url = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = 'http://127.0.0.1:1'; // nothing listens here
    try {
      const result = await signInWithPassword('kit@example.com', 'pw');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/could not be reached/i);
    } finally {
      process.env.SUPABASE_URL = url;
    }
  });
});
