import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Orbit installs into one schema, `orbit`, so that it can share a Supabase
 * project with other work. That is not a property you can see by reading any
 * one file — it is a property of every SQL string in the repository at once,
 * and it breaks the moment somebody writes `public.tasks` out of habit.
 *
 * The failure mode is the reason this is a test rather than a convention: a
 * query against `public.tasks` in a project that has a `public.tasks` of its
 * own does not error. It reads somebody else's rows.
 *
 * Same shape as tests/capture.test.ts, which reads its own source back to prove
 * nothing in the capture parser ever reaches the network.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function filesUnder(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...filesUnder(rel, exts));
    else if (exts.some((e) => entry.endsWith(e))) out.push(rel);
  }
  return out;
}

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * The same file with `--` comments removed.
 *
 * The checks below that ask "does this file *do* X" have to read code rather
 * than prose, because the comments in these migrations discuss the schema move
 * at length — including, by name, the `app` schema that no longer exists and
 * the pgcrypto call that was replaced. Three of these tests failed on their
 * own explanations before this existed.
 *
 * Deliberately crude: a `--` inside a string literal would be treated as a
 * comment. No migration has one, and the cost of being wrong is a check that
 * looks at slightly less text, not one that passes something it should catch.
 */
const code = (rel: string) => read(rel).replace(/--[^\n]*/g, '');

const MIGRATIONS = filesUnder('supabase/migrations', ['.sql']).sort();

/** Everything that talks to Postgres. Docs are excluded: prose may say `public`. */
const SQL_BEARING = [
  ...MIGRATIONS,
  ...filesUnder('supabase/tests', ['.sql']),
  'supabase/seed/seed.ts',
  ...filesUnder('src', ['.ts', '.tsx']),
];

// A schema qualifier, not prose: the dot must be followed by an identifier.
const PUBLIC_QUALIFIED = /\bpublic\.[a-z_]/;
const APP_QUALIFIED = /\bapp\.[a-z_]/;

describe('every Orbit object lives in the orbit schema', () => {
  it('has migrations to check, so a passing run is not an empty one', () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(13);
    expect(SQL_BEARING.length).toBeGreaterThan(100);
  });

  it('never qualifies anything with `public.`', () => {
    const offenders = SQL_BEARING.filter((f) => PUBLIC_QUALIFIED.test(read(f)));
    expect(offenders, `these name the public schema: ${offenders.join(', ')}`).toEqual([]);
  });

  it('never qualifies anything with `app.`, the schema this replaced', () => {
    const offenders = SQL_BEARING.filter((f) => APP_QUALIFIED.test(read(f)));
    expect(offenders, `these name the app schema: ${offenders.join(', ')}`).toEqual([]);
  });

  it('creates `orbit` and creates no other schema but the auth shim', () => {
    const created = MIGRATIONS.flatMap((f) =>
      [...code(f).matchAll(/create schema if not exists (\w+)/g)].map((m) => m[1]),
    );
    expect(created).toContain('orbit');
    // `auth` is Supabase's and is only shimmed for a local cluster; it is the
    // one schema Orbit is allowed to name because auth.users is not ours.
    expect([...new Set(created)].sort()).toEqual(['auth', 'orbit']);
  });

  it('pins the search_path in every migration, so an unqualified CREATE cannot drift', () => {
    const unpinned = MIGRATIONS.filter((f) => !/set search_path = orbit,/.test(read(f)));
    expect(unpinned, `these do not pin a search_path: ${unpinned.join(', ')}`).toEqual([]);
  });

  it('pins a search_path reaching the extensions, wherever an installation put them', () => {
    // PostGIS and pgcrypto are in `extensions` on Supabase and `public` on a
    // local cluster. Naming both is what lets one migration run in either.
    for (const f of MIGRATIONS) {
      expect(read(f)).toMatch(/set search_path = orbit, public, extensions/);
    }
  });

  it('writes outside `orbit` in exactly one place, and that place is the auth.users trigger', () => {
    const touchesAuth = MIGRATIONS.filter((f) => /\bauth\.users\b/.test(code(f)));
    expect(touchesAuth).toEqual(['supabase/migrations/0012_auth_user_profiles.sql']);
  });

  it('keeps every SECURITY DEFINER function off the extension schemas', () => {
    // A definer function runs with the owner's rights, so its search_path is
    // pinned narrowly on purpose. That means it cannot call pgcrypto — see
    // orbit.space_invite(), which uses pg_catalog's sha256 instead.
    for (const f of MIGRATIONS) {
      const body = code(f);
      if (!/security definer/.test(body)) continue;
      for (const m of body.matchAll(/security definer\s*\n\s*set search_path = ([^\n]+)/g)) {
        expect(m[1]).toMatch(/^orbit, pg_temp$/);
      }
    }
  });

  it('never calls a pgcrypto function, which no pinned search_path can reach', () => {
    for (const f of [...MIGRATIONS, ...filesUnder('supabase/tests', ['.sql'])]) {
      expect(code(f), `${f} calls a pgcrypto function`).not.toMatch(
        /\b(digest|hmac|crypt|gen_salt)\s*\(/,
      );
    }
  });
});
