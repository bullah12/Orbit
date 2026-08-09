import 'server-only';
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { poolMax } from './config';

/**
 * The only way the application talks to Postgres.
 *
 * The pool connects as `orbit_app`, which owns no tables and has no BYPASSRLS.
 * Every query therefore runs under the same policies the pgTAP suite asserts.
 * There is deliberately no service-role client here: if a page needs data the
 * current user cannot see, that is a policy question, not a client question.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://orbit_app:orbit_dev_password@localhost:5432/orbit';

declare global {
  // eslint-disable-next-line no-var
  var __orbitSql: Sql | undefined;
}

// Next's dev server re-evaluates modules on every edit; without this the pool
// leaks a connection per hot reload until Postgres refuses new ones.
export const pool: Sql =
  globalThis.__orbitSql ??
  postgres(DATABASE_URL, {
    // 10 in a container, 1 on serverless — see src/lib/db/config.ts. The
    // number that matters is this one times the number of processes, and only
    // the deployment knows that.
    max: poolMax(),
    idle_timeout: 20,
    // Supabase's transaction pooler (port 6543) hands a different backend to
    // every statement, so a prepared statement is never there when it is used
    // again and `asUser`'s queries fail. Session mode (5432) has no such
    // problem. This is an env flag rather than a code edit at deploy time
    // because "change this line before you deploy" is an instruction somebody
    // eventually does not follow. Default unchanged: prepared statements on.
    prepare: process.env.DATABASE_PREPARE !== 'false',
    // Dates and timestamps come back as strings and are formatted once, in
    // src/lib/format.ts, against Europe/London. Letting the driver build JS
    // Dates here would silently reintroduce the server's timezone.
    types: {
      date: {
        to: 1082,
        from: [1082, 1114, 1184],
        serialize: (x: unknown) => (x instanceof Date ? x.toISOString() : String(x)),
        parse: (x: string) => x,
      },
    },
    transform: { undefined: null },
  });

if (process.env.NODE_ENV !== 'production') globalThis.__orbitSql = pool;

export type Tx = TransactionSql<Record<string, never>>;

/**
 * Run `fn` inside a transaction acting as `userId`.
 *
 * `set local role authenticated` is what makes the policies bite: the pool's
 * login role could otherwise inherit privileges it should not use. `set local`
 * scopes both settings to this transaction, so a pooled connection cannot carry
 * one request's identity into the next.
 */
export async function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return pool.begin(async (tx) => {
    await tx.unsafe('set local role authenticated');
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId })}, true)`;
    return fn(tx as Tx);
  }) as Promise<T>;
}

/**
 * Anonymous access. Exists so an unauthenticated page cannot accidentally reach
 * the pool's default privileges — it gets the `anon` role, which is granted
 * nothing.
 */
export async function asAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return pool.begin(async (tx) => {
    await tx.unsafe('set local role anon');
    return fn(tx as Tx);
  }) as Promise<T>;
}
