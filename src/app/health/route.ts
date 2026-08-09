import { pool } from '@/lib/db';

/**
 * A health check for the hosting platform.
 *
 * Fly and Railway both want a cheap endpoint that says whether a machine should
 * be kept in rotation. Without one they fall back to "did the port open", which
 * is true of a container whose database credentials are wrong and which cannot
 * serve a single page.
 *
 * So this touches the database — `select 1`, no table, no policy, no user — and
 * that is the whole point: the single most likely production failure is a
 * `DATABASE_URL` that does not work, and a health check that cannot see it is
 * not a health check.
 *
 * **Deliberately says nothing.** `ok` or `unavailable`, and a status code. No
 * version, no hostname, no connection string, no error text: this endpoint is
 * unauthenticated by necessity, and an error message from a failed connection
 * is exactly the sort of thing that names an internal host. Whoever is
 * debugging has the container's logs, which is where the detail belongs.
 */

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await pool`select 1`;
    return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    // Logged, not returned. The platform needs a number; a person needs the log.
    console.error('[health] database unreachable:', err);
    return Response.json(
      { status: 'unavailable' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
