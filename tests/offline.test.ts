import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CACHEABLE_PREFIXES,
  CACHE_VERSION,
  OFFLINE_TOKENS,
  OFFLINE_URL,
  PRECACHE_URLS,
  swDecision,
  swPolicy,
  type SwRequest,
} from '@/lib/offline';

/**
 * The offline shell's policy.
 *
 * One rule matters more than the rest and most of this file is about it: **no
 * authenticated page HTML is ever cached**. Every page in Orbit is
 * `force-dynamic` and RLS-scoped, so a cached `/tasks/home` handed to whoever
 * opens the phone next is a data leak — and unlike a stale asset, nothing about
 * looking at it would say so.
 */

const req = (over: Partial<SwRequest> = {}): SwRequest => ({
  path: '/',
  method: 'GET',
  sameOrigin: true,
  ...over,
});

describe('a page is never cached', () => {
  const PAGES = [
    '/', '/tasks/home', '/tasks/mine', '/calendar/week', '/people', '/people/abc',
    '/notes/1', '/search', '/spaces', '/spaces/1', '/sync', '/settings', '/ai',
    '/invite/some-raw-token', '/auth/signin', '/travel', '/places/9',
  ];

  it.each(PAGES)('%s is fetched from the network, never served from a cache', (path) => {
    expect(swDecision(req({ path, mode: 'navigate' }))).toBe('network-then-offline');
    expect(swDecision(req({ path, destination: 'document' }))).toBe('network-then-offline');
  });

  it('and "network-then-offline" only ever falls back to the offline page', () => {
    // The name is the contract: on failure it serves OFFLINE_URL, which carries
    // no user data, and never a previous response for the requested page.
    expect(PRECACHE_URLS).toContain(OFFLINE_URL);
  });

  it('never caches per-request page data either', () => {
    // /_next/data is the authenticated-HTML rule wearing a different name.
    for (const path of ['/_next/data/build/tasks/home.json', '/_next/image', '/_next/image/x']) {
      expect(swDecision(req({ path })), path).toBe('network-only');
    }
  });
});

describe('only content-hashed assets and the shell are cached', () => {
  it('caches the build’s static files', () => {
    for (const path of [
      '/_next/static/chunks/main-abc123.js',
      '/_next/static/css/def456.css',
      '/_next/static/media/font.woff2',
    ]) {
      expect(swDecision(req({ path, destination: 'script' })), path).toBe('cache-first');
    }
  });

  it('caches the offline page and the manifest', () => {
    expect(swDecision(req({ path: OFFLINE_URL }))).toBe('cache-first');
    expect(swDecision(req({ path: '/manifest.webmanifest' }))).toBe('cache-first');
  });

  it('refuses the manifest when it carried a query string', () => {
    // A cache keyed on the path alone must not answer for a URL that had one.
    expect(swDecision(req({ path: '/manifest.webmanifest', hasSearch: true }))).toBe(
      'network-only',
    );
  });

  it('caches nothing that merely looks like a static path', () => {
    for (const path of [
      '/static/x.js',
      '/_next/staticky/x.js',
      '/tasks/_next/static/x.js',
      '/api/_next/static/x.js',
    ]) {
      expect(swDecision(req({ path })), path).toBe('network-only');
    }
  });
});

describe('everything else defaults to the network', () => {
  it('never touches a non-GET, so a server action cannot be replayed', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      expect(swDecision(req({ path: '/_next/static/chunks/a.js', method })), method).toBe(
        'network-only',
      );
      expect(swDecision(req({ path: '/', method, mode: 'navigate' })), method).toBe(
        'network-only',
      );
    }
  });

  it('never holds another origin’s response', () => {
    expect(swDecision(req({ path: '/_next/static/a.js', sameOrigin: false }))).toBe('network-only');
    expect(swDecision(req({ path: OFFLINE_URL, sameOrigin: false }))).toBe('network-only');
    expect(swDecision(req({ path: '/', mode: 'navigate', sameOrigin: false }))).toBe(
      'network-only',
    );
  });

  it('is conservative about shapes nobody considered', () => {
    // The default has to be network-only: an unfamiliar request should behave
    // exactly as it would with no service worker installed.
    for (const path of ['/api/anything', '/robots.txt', '/favicon.ico', '/some/new/route']) {
      expect(swDecision(req({ path })), path).toBe('network-only');
    }
  });

  it('is total — every combination returns one of the three', () => {
    const paths = ['/', '/offline', '/_next/static/a.js', '/manifest.webmanifest', '/x'];
    const modes = [undefined, 'navigate', 'cors', 'no-cors', 'same-origin'];
    const methods = ['GET', 'POST'];
    const allowed = ['cache-first', 'network-only', 'network-then-offline'];

    for (const path of paths) {
      for (const mode of modes) {
        for (const method of methods) {
          for (const sameOrigin of [true, false]) {
            expect(allowed).toContain(swDecision({ path, mode, method, sameOrigin }));
          }
        }
      }
    }
  });
});

describe('the policy handed to the worker is the policy that was tested', () => {
  it('carries the same version, precache list, offline URL and prefixes', () => {
    const p = swPolicy();
    expect(p.version).toBe(CACHE_VERSION);
    expect(p.precache).toEqual([...PRECACHE_URLS]);
    expect(p.offlineUrl).toBe(OFFLINE_URL);
    expect(p.cacheablePrefixes).toEqual([...CACHEABLE_PREFIXES]);
  });

  it('is plain JSON, because that is how it reaches the worker', () => {
    // The worker is generated by embedding this as JSON. A value that does not
    // survive the round trip would mean the shipped rules differ from these.
    const p = swPolicy();
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });

  it('precaches nothing that could carry user data', () => {
    // Both entries render identically for everybody. Anything else in this list
    // would be baked into a cache belonging to whoever installed the worker.
    expect([...PRECACHE_URLS].sort()).toEqual(['/manifest.webmanifest', '/offline']);
  });
});

describe('the offline page’s colours cannot drift from the stylesheet', () => {
  /**
   * `/offline` is standalone HTML so no user data can reach it, which also
   * means it cannot link to the build's hashed stylesheet. Its four colours are
   * therefore a second copy of four tokens — exactly the drift the
   * `light-dark()` merge existed to remove — so each is pinned to its source.
   */
  const css = readFileSync(
    fileURLToPath(new URL('../src/app/globals.css', import.meta.url)),
    'utf8',
  );

  function declared(token: string): string {
    const m = css.match(
      new RegExp(`--${token}:\\s*(light-dark\\([^;]*\\))\\s*;`),
    );
    expect(m, `--${token} is declared in globals.css as a light-dark() pair`).not.toBeNull();
    return m![1]!.replace(/\s+/g, ' ');
  }

  const PAIRS: [keyof typeof OFFLINE_TOKENS, string][] = [
    ['bg', 'bg'],
    ['text', 'text'],
    ['muted', 'text-muted'],
    ['accent', 'accent'],
  ];

  it.each(PAIRS)('the offline page’s %s is globals.css’s --%s', (key, token) => {
    expect(OFFLINE_TOKENS[key].replace(/\s+/g, ' ')).toBe(declared(token));
  });
});
