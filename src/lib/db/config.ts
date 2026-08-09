/**
 * Connection-pool settings that depend on where Orbit is running.
 *
 * Pure and free of `server-only` so the rules are testable without a database.
 * `src/lib/db/index.ts` is the only caller.
 */

/** What `max` should be when nothing says otherwise: a long-lived container. */
export const DEFAULT_POOL_MAX = 10;

/**
 * How many Postgres connections one process may hold.
 *
 * The number that matters is not this one, it is **this one times the number of
 * processes**, and that count is a property of the host rather than of the app:
 *
 *  - **A container** (Fly, Railway, Docker) is one long-lived process. Ten
 *    connections is ten, and pooling them is the whole point — a pool is an
 *    asset when the process outlives the request.
 *  - **A serverless function** (Vercel) is one process *per concurrent
 *    request*, each with its own pool. Ten there means ten × however many
 *    instances the platform decided to start, which is how a quiet app
 *    exhausts a database during its first busy minute. Set this to `1` and let
 *    Supabase's transaction pooler do the pooling, which is what it is for.
 *
 * An env var rather than a code branch on `process.env.VERCEL`, because the
 * shape of the deployment is a deployment decision and should be visible in the
 * deployment's own configuration rather than inferred by the app.
 *
 * Anything unparseable, zero or negative falls back to the default rather than
 * producing a pool of `NaN` — which `postgres` accepts and then behaves
 * unpredictably around.
 */
export function poolMax(raw: string | undefined = process.env.DATABASE_POOL_MAX): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_POOL_MAX;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return DEFAULT_POOL_MAX;
  return n;
}
