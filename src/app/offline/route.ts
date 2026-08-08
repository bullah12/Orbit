import { OFFLINE_TOKENS } from '@/lib/offline';

/**
 * The offline page.
 *
 * A route handler returning standalone HTML rather than a React page, and that
 * is the security decision on this whole feature rather than a styling
 * shortcut. This document is fetched once at service-worker install and then
 * held in a cache indefinitely, so whatever is in it is in it for good. A page
 * component would be wrapped in the root layout, which renders the sidebar —
 * space names, smart-list counts, the account panel — and all of that would be
 * baked into a cache entry belonging to whoever happened to install the worker.
 *
 * From here there is no way for that to happen: nothing on this route reads a
 * cookie, a user or the database. It renders identically for everybody, which
 * is the property that makes it safe to keep.
 *
 * It is honest about what Orbit can and cannot do without a network, and links
 * to `/sync`, which is where unsent edits actually live.
 */

export const dynamic = 'force-static';

const HTML = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Offline — Orbit</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: ${OFFLINE_TOKENS.bg};
    --text: ${OFFLINE_TOKENS.text};
    --muted: ${OFFLINE_TOKENS.muted};
    --accent: ${OFFLINE_TOKENS.accent};
  }
  :root[data-theme='light'] { color-scheme: only light; }
  :root[data-theme='dark']  { color-scheme: only dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem 1.25rem;
    background: var(--bg);
    color: var(--text);
    font: 0.875rem/1.45 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  main { max-width: 32rem; }
  h1 { font-size: 1.0625rem; line-height: 1.28; margin: 0 0 0.5rem; }
  p { color: var(--muted); font-size: 0.8125rem; margin: 0 0 0.75rem; }
  ul { color: var(--muted); font-size: 0.8125rem; margin: 0 0 0.75rem; padding-left: 1.1rem; }
  li { margin-bottom: 0.25rem; }
  a { color: var(--accent); }
  .actions { margin-top: 1.25rem; display: flex; flex-wrap: wrap; gap: 0.5rem; }
  button, .btn {
    font: inherit;
    font-size: 0.8125rem;
    padding: 0.25rem 0.625rem;
    border-radius: 0.25rem;
    border: 1px solid var(--muted);
    background: none;
    color: var(--text);
    text-decoration: none;
    cursor: pointer;
  }
</style>
</head>
<body>
<main>
  <h1>Orbit is offline</h1>
  <p>
    This device has no connection, so Orbit cannot load a page. Your data is on
    the server and none of it has been lost.
  </p>

  <p><strong>What still works</strong></p>
  <ul>
    <li>Edits you already made offline are queued in this browser and will be sent when the connection returns.</li>
    <li>Pages you had open before the connection dropped are still on screen.</li>
  </ul>

  <p><strong>What does not</strong></p>
  <ul>
    <li>Opening a page you have not already got open. Every page is rendered for you specifically, so none of them is kept on this device — a stored copy could be shown to whoever picks the phone up next.</li>
    <li>Search, the calendar and anything that asks the server a question.</li>
  </ul>

  <p>
    <a href="/sync">Sync</a> lists what this browser has not sent yet, and names
    any edit that clashed with somebody else’s rather than resolving it quietly.
  </p>

  <div class="actions">
    <button type="button" onclick="location.reload()">Try again</button>
    <a class="btn" href="/sync">Go to Sync</a>
  </div>
</main>
</body>
</html>
`;

export async function GET(): Promise<Response> {
  return new Response(HTML, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Held by the service worker, not by the HTTP cache: a bump to
      // CACHE_VERSION is what replaces it, and an intermediary holding its own
      // copy would make that bump take an unpredictable amount of time.
      'cache-control': 'no-store',
    },
  });
}
