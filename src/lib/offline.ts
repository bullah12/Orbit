/**
 * The offline shell: what a service worker is allowed to keep, and what it must
 * never keep.
 *
 * Pure and free of imports, because two very different things consume it — the
 * Vitest suite, and the service worker source that `src/app/sw.js/route.ts`
 * generates. The *policy* here is data; the *mechanism* (install, activate,
 * fetch) is about sixty lines in that route. Keeping the two apart is what
 * stops the rules being written twice and drifting, which is the classic way a
 * service worker starts serving something it should not.
 *
 * ---------------------------------------------------------------------------
 * The rule that matters, and why it is the whole design
 * ---------------------------------------------------------------------------
 *
 * **No authenticated page HTML is ever cached.** Every page in Orbit is
 * `force-dynamic`, RLS-scoped and rendered for one person. A cached
 * `/tasks/home` served to whoever opens the phone next is a data leak, not a
 * nicety — and unlike a stale asset it cannot be noticed by looking at it.
 *
 * So a navigation is network-only. When the network is not there it falls back
 * to `/offline`, which is a route handler carrying no user data at all: not a
 * React page, so the sidebar — with its space names and task counts — cannot
 * reach it even by accident. That is why the offline page is HTML from a route
 * rather than a page component with `export const dynamic`.
 *
 * What is cached is genuinely the shell: `/offline` itself, the manifest, and
 * the build's static assets under `/_next/static/`, which are content-hashed,
 * immutable, and contain nobody's data. That is a smaller promise than most
 * offline stories, and it is the honest one for this app — `src/lib/sync/` is
 * where offline *editing* lives, and the offline page says so and links to it.
 */

/**
 * Bumped whenever the shell's contents change.
 *
 * `activate` deletes every cache whose name is not this one, so a bump is also
 * how a stale shell is thrown away. A service worker that cannot be updated is
 * the classic way to ship an app that cannot be fixed.
 */
export const CACHE_VERSION = 'orbit-shell-v1';

/** Fetched and cached at install. Both are safe to hold: neither knows who you are. */
export const PRECACHE_URLS = ['/offline', '/manifest.webmanifest'] as const;

/** Where a failed navigation lands. */
export const OFFLINE_URL = '/offline';

/**
 * Path prefixes that may be cached and served cache-first.
 *
 * `/_next/static/` only. Those filenames carry a content hash, so a cached one
 * is never stale — the URL changes when the bytes do. `/_next/image` and
 * `/_next/data` are deliberately absent: the first can be given any URL and the
 * second is per-request page data, which is the authenticated HTML rule wearing
 * a different name.
 */
export const CACHEABLE_PREFIXES = ['/_next/static/'] as const;

export type SwDecision = 'cache-first' | 'network-only' | 'network-then-offline';

export type SwRequest = {
  /** Same-origin path, with no query string. */
  path: string;
  method: string;
  /** `request.mode` — 'navigate' for a page load. */
  mode?: string;
  /** `request.destination` — 'document', 'script', 'style', … */
  destination?: string;
  sameOrigin: boolean;
  /** Whether the request carried a query string. */
  hasSearch?: boolean;
};

/**
 * What the service worker should do with one request.
 *
 * Deliberately total and deliberately conservative: anything this function has
 * no specific reason to cache is `network-only`, so a request shape nobody
 * thought about behaves exactly as it would with no service worker installed.
 */
export function swDecision(req: SwRequest): SwDecision {
  // Only GET is ever considered. A POST is a server action — the whole of how
  // Orbit writes — and replaying or caching one would be a way to make an edit
  // happen twice.
  if (req.method !== 'GET') return 'network-only';

  // Another origin's response is not this app's to hold.
  if (!req.sameOrigin) return 'network-only';

  // A page load. Never cached; falls back to the offline page when the network
  // is gone. See the note at the top — this is the rule the design is built on.
  if (req.mode === 'navigate' || req.destination === 'document') {
    return 'network-then-offline';
  }

  if (req.path === OFFLINE_URL) return 'cache-first';

  // The manifest is static and public, but only without a query string: a
  // cache keyed on the path alone must not answer for a URL that carried one.
  if (req.path === '/manifest.webmanifest') {
    return req.hasSearch ? 'network-only' : 'cache-first';
  }

  if (CACHEABLE_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
    return 'cache-first';
  }

  return 'network-only';
}

/** The policy the generated service worker is handed, as data rather than code. */
export function swPolicy() {
  return {
    version: CACHE_VERSION,
    precache: [...PRECACHE_URLS],
    offlineUrl: OFFLINE_URL,
    cacheablePrefixes: [...CACHEABLE_PREFIXES],
  };
}

/**
 * The four colours the offline page needs, and the reason they are here.
 *
 * `/offline` is served as standalone HTML so that no user data can reach it,
 * which also means it cannot link to the build's hashed stylesheet — the
 * filename is not knowable when the route is written. These are therefore a
 * second copy of four tokens, which is exactly the drift the `light-dark()`
 * merge existed to remove, so `tests/offline.test.ts` pins every one of them to
 * `globals.css` and fails if either side moves.
 */
export const OFFLINE_TOKENS = {
  bg: 'light-dark(oklch(98.6% 0.002 265), oklch(16.5% 0.008 265))',
  text: 'light-dark(oklch(22% 0.014 265), oklch(95% 0.004 265))',
  muted: 'light-dark(oklch(47.5% 0.013 265), oklch(74% 0.009 265))',
  accent: 'light-dark(oklch(48% 0.14 258), oklch(76% 0.12 258))',
} as const;
