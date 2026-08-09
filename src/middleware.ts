import { NextResponse, type NextRequest } from 'next/server';

/**
 * Authenticated HTML is never stored — by the browser either.
 *
 * The service worker was built on one rule: a page rendered for one person must
 * not be kept, because a stored copy served to whoever opens the phone next is
 * a data leak rather than a convenience. `src/lib/offline.ts` is careful about
 * it and `tests/offline.test.ts` proves it.
 *
 * Then the smoke run found the hole a layer down. With the network disabled,
 * `/tasks/all` came back anyway — sidebar, task counts, the lot — because the
 * *browser's own* HTTP cache still had it. The service worker had cached
 * nothing; it called `fetch()`, and `fetch()` was answered from disk. Every
 * page here is `force-dynamic` and RLS-scoped, so none of them was ever safe to
 * keep, and nothing had said so out loud in a header.
 *
 * `no-store` says it. It is the same sentence the design already depended on,
 * addressed to the one cache that had not been told.
 *
 * The matcher excludes what is genuinely cacheable and says why for each:
 *  - `_next/static` — content-hashed and immutable; caching these is the point
 *    of the shell, and `no-store` here would make every navigation re-download
 *    the whole bundle.
 *  - `_next/image` — Next's own optimiser sets what it needs.
 *  - `sw.js`, `offline`, `manifest.webmanifest` — each already sends the header
 *    it wants, and the first two deliberately send `no-store` themselves so a
 *    new worker can replace an old one promptly.
 */
/**
 * The path, forwarded to the server components that render it.
 *
 * A layout has no way to ask which page is underneath it — that is by design,
 * and the usual answer is a client component calling `usePathname()`. The
 * capture bar in the root layout needs it for one decision (do not render a
 * second copy of the field on the capture page itself) and that is not worth
 * shipping JavaScript for, so the path arrives as a request header instead.
 * Absent, everything falls back to rendering the bar.
 */
export const PATH_HEADER = 'x-orbit-path';

export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, request.nextUrl.pathname);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Cache-Control', 'no-store, must-revalidate');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|sw\\.js|offline|manifest\\.webmanifest|favicon\\.ico).*)'],
};
