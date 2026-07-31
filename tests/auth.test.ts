import { describe, expect, it } from 'vitest';
import {
  accessTokenExpired,
  authProviderName,
  decodeJwtPayloadUnverified,
  displayNameFrom,
  parseTokenResponse,
  safeNextPath,
  subjectOf,
  supabaseErrorSentence,
  usesDevAuth,
} from '@/lib/auth/session';

/**
 * The auth rules that are decisions rather than I/O.
 *
 * None of this talks to Supabase, because there is no Supabase project here —
 * the provider itself is written and never run, exactly like the Google
 * calendar provider, and no test in this file pretends otherwise. What is
 * covered is everything that decides an outcome once an answer has arrived:
 * which provider is live, whether a token is worth using, what a display name
 * becomes, and what a failure is allowed to say.
 */

/** A JWT with the given payload, signed with nothing. Never verified here. */
function jwt(payload: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(payload)}.not-a-signature`;
}

describe('which provider is live', () => {
  it('is dev with nothing set, because zero credentials is the standing rule', () => {
    expect(authProviderName({} as unknown as NodeJS.ProcessEnv)).toBe('dev');
    expect(usesDevAuth({} as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it('is dev for an empty or whitespace value rather than an unknown provider', () => {
    expect(authProviderName({ AUTH_PROVIDER: '   ' } as unknown as NodeJS.ProcessEnv)).toBe('dev');
  });

  it('reads the value it is given', () => {
    const env = { AUTH_PROVIDER: 'supabase' } as unknown as NodeJS.ProcessEnv;
    expect(authProviderName(env)).toBe('supabase');
    expect(usesDevAuth(env)).toBe(false);
  });

  it('treats anything that is not dev as not dev — the switcher hides for all of them', () => {
    for (const name of ['supabase', 'Dev', 'DEV', 'oidc', 'none']) {
      expect(usesDevAuth({ AUTH_PROVIDER: name } as unknown as NodeJS.ProcessEnv)).toBe(name === 'dev');
    }
  });
});

describe('reading a token without trusting it', () => {
  it('decodes a payload', () => {
    expect(decodeJwtPayloadUnverified(jwt({ sub: 'abc', exp: 10 }))).toEqual({
      sub: 'abc',
      exp: 10,
    });
  });

  it('refuses anything that is not three parts', () => {
    expect(decodeJwtPayloadUnverified('nonsense')).toBeNull();
    expect(decodeJwtPayloadUnverified('a.b')).toBeNull();
    expect(decodeJwtPayloadUnverified('')).toBeNull();
  });

  it('refuses a payload that is not an object, rather than returning one', () => {
    const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    expect(decodeJwtPayloadUnverified(`x.${part(['a'])}.y`)).toBeNull();
    expect(decodeJwtPayloadUnverified(`x.${part('a string')}.y`)).toBeNull();
    expect(decodeJwtPayloadUnverified('x.not-base64-json.y')).toBeNull();
  });

  it('finds the sub, which is the id every policy keys off', () => {
    expect(subjectOf(jwt({ sub: '00000000-0000-4000-8000-000000000001' }))).toBe(
      '00000000-0000-4000-8000-000000000001',
    );
    expect(subjectOf(jwt({ sub: '' }))).toBeNull();
    expect(subjectOf(jwt({ nothing: true }))).toBeNull();
  });
});

describe('when an access token is past using', () => {
  const now = Date.parse('2026-07-31T12:00:00Z');

  it('is not expired well before exp', () => {
    expect(accessTokenExpired(jwt({ exp: now / 1000 + 600 }), now)).toBe(false);
  });

  it('is expired after exp', () => {
    expect(accessTokenExpired(jwt({ exp: now / 1000 - 1 }), now)).toBe(true);
  });

  it('is expired inside the margin, because a token expiring in two seconds expires mid-request', () => {
    expect(accessTokenExpired(jwt({ exp: now / 1000 + 5 }), now)).toBe(true);
    expect(accessTokenExpired(jwt({ exp: now / 1000 + 31 }), now)).toBe(false);
  });

  it('treats a token it cannot read as expired, so the safe path is the default', () => {
    expect(accessTokenExpired('not-a-jwt', now)).toBe(true);
    expect(accessTokenExpired(jwt({ sub: 'x' }), now)).toBe(true);
    expect(accessTokenExpired(jwt({ exp: 'soon' }), now)).toBe(true);
  });
});

describe('the display name a new account gets', () => {
  it('prefers what the sign-up form said', () => {
    expect(displayNameFrom({ display_name: 'Nadia Ferreira' }, 'n@example.com')).toBe(
      'Nadia Ferreira',
    );
  });

  it('accepts the other spellings Supabase projects use', () => {
    expect(displayNameFrom({ full_name: 'Sam Okafor' }, 'sam@example.com')).toBe('Sam Okafor');
    expect(displayNameFrom({ name: 'Sam' }, 'sam@example.com')).toBe('Sam');
    expect(displayNameFrom({ displayName: 'Sam O' }, 'sam@example.com')).toBe('Sam O');
  });

  it('falls back to the email local part rather than to an empty name', () => {
    expect(displayNameFrom({}, 'quiet.person@example.com')).toBe('quiet.person');
    expect(displayNameFrom(null, 'quiet.person@example.com')).toBe('quiet.person');
    expect(displayNameFrom({ display_name: '   ' }, 'quiet.person@example.com')).toBe(
      'quiet.person',
    );
  });

  it('never returns an empty string, because a blank name renders as a gap on every row', () => {
    expect(displayNameFrom({}, '@example.com')).toBe('@example.com');
    expect(displayNameFrom({}, '')).toBe('');
  });

  it('trims and caps, so a pasted essay cannot become a display name', () => {
    expect(displayNameFrom({ display_name: '  Priya  ' }, 'p@example.com')).toBe('Priya');
    expect(displayNameFrom({ display_name: 'x'.repeat(500) }, 'p@example.com')).toHaveLength(120);
  });

  it('agrees with the SQL in migration 0012 about the order it tries', () => {
    // The trigger tries display_name, displayName, full_name, name, then the
    // local part. If these two ever disagree, the name in the database is not
    // the name the person typed.
    expect(
      displayNameFrom({ name: 'last', full_name: 'third', display_name: 'first' }, 'a@b.c'),
    ).toBe('first');
    expect(displayNameFrom({ name: 'last', full_name: 'third' }, 'a@b.c')).toBe('third');
  });
});

describe('reading a session out of a token response', () => {
  it('takes the id from the user object', () => {
    const parsed = parseTokenResponse({
      access_token: jwt({ sub: 'from-token' }),
      refresh_token: 'r',
      user: { id: 'from-user', email: 'a@b.c', user_metadata: { display_name: 'A B' } },
    });
    expect(parsed).toEqual({
      accessToken: expect.any(String),
      refreshToken: 'r',
      userId: 'from-user',
      email: 'a@b.c',
      displayName: 'A B',
    });
  });

  it('falls back to the token’s own sub when there is no user object', () => {
    const parsed = parseTokenResponse({ access_token: jwt({ sub: 'only-in-token' }) });
    expect('error' in parsed ? null : parsed.userId).toBe('only-in-token');
  });

  it('is an error, not an undefined, when there is no access token', () => {
    expect(parseTokenResponse({ refresh_token: 'r' })).toEqual({
      error: 'Supabase returned no access token.',
    });
    expect(parseTokenResponse(null)).toEqual({ error: 'Supabase returned no session.' });
    expect(parseTokenResponse('a string')).toEqual({ error: 'Supabase returned no session.' });
  });

  it('is an error when nothing identifies anybody — a session with no subject is not a session', () => {
    expect(parseTokenResponse({ access_token: 'not-a-jwt' })).toEqual({
      error: 'Supabase returned a token with no subject.',
    });
  });

  it('accepts a missing refresh token rather than refusing the session', () => {
    const parsed = parseTokenResponse({ access_token: jwt({ sub: 's' }) });
    expect('error' in parsed ? null : parsed.refreshToken).toBe('');
  });
});

describe('what a failure is allowed to say', () => {
  it('prefers whatever Supabase said, whichever field it said it in', () => {
    expect(supabaseErrorSentence(400, { error_description: 'Invalid login credentials' })).toBe(
      'Invalid login credentials',
    );
    expect(supabaseErrorSentence(400, { msg: 'Email not confirmed' })).toBe('Email not confirmed');
    expect(supabaseErrorSentence(422, { message: 'User already registered' })).toBe(
      'User already registered',
    );
  });

  it('never leaves somebody with only a status code', () => {
    expect(supabaseErrorSentence(400, {})).toBe('Those details were not accepted.');
    expect(supabaseErrorSentence(429, null)).toMatch(/wait a minute/i);
    expect(supabaseErrorSentence(503, null)).toBe('Supabase answered 503.');
  });

  it('ignores a non-string field rather than rendering an object', () => {
    expect(supabaseErrorSentence(400, { message: { nested: true } })).toBe(
      'Those details were not accepted.',
    );
  });
});

describe('where somebody may be sent after signing in', () => {
  it('keeps an in-app path', () => {
    expect(safeNextPath('/tasks/all')).toBe('/tasks/all');
    expect(safeNextPath('/spaces/abc?joined=1')).toBe('/spaces/abc?joined=1');
  });

  it('refuses anything that could leave the site — a sign-in page is where an open redirect lives', () => {
    expect(safeNextPath('https://example.com/phish')).toBe('/');
    expect(safeNextPath('//example.com/phish')).toBe('/');
    expect(safeNextPath('/\\example.com')).toBe('/');
    expect(safeNextPath('javascript:alert(1)')).toBe('/');
  });

  it('is / for nothing at all', () => {
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath(undefined)).toBe('/');
    expect(safeNextPath('')).toBe('/');
  });
});
