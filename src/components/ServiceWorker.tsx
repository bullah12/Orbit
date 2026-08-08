'use client';

import { useEffect, useState } from 'react';

/**
 * Registering the service worker, and being able to get rid of it.
 *
 * Two components in one file because they are two halves of one decision: a
 * service worker that cannot be removed is the classic way to ship an app that
 * cannot be updated, so the thing that installs it and the thing that removes
 * it are written together and read together.
 *
 * Both are no-ops where `serviceWorker` is absent — an older browser, a page
 * served over plain HTTP, a privacy mode that withholds it. Nothing here is
 * load-bearing: with no worker at all, Orbit behaves exactly as it did before
 * this file existed, and shows the browser's own network error offline.
 */

/** Registers on mount. Rendered once, in the layout. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    // After load rather than during it: registration competes with the first
    // render for the same connection, and the shell is not needed until the
    // *next* visit anyway.
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // A failed registration is not worth interrupting anybody for. The app
        // works without one; this is the difference between a network error and
        // a page that explains itself.
      });
    };

    if (document.readyState === 'complete') register();
    else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}

type State = 'unknown' | 'none' | 'registered' | 'removing' | 'removed';

/**
 * The unregister control, on /settings.
 *
 * It clears the caches as well as unregistering, because a worker that has
 * stood down does not empty what it kept — and the point of pressing this is
 * usually that something in there is wrong.
 */
export function ServiceWorkerControl() {
  const [state, setState] = useState<State>('unknown');

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      setState('none');
      return;
    }
    navigator.serviceWorker
      .getRegistration('/')
      .then((reg) => setState(reg ? 'registered' : 'none'))
      .catch(() => setState('none'));
  }, []);

  async function remove() {
    setState('removing');
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      // Ask the worker to drop its caches first — it owns them, and a page
      // cannot always reach the Cache Storage a worker created.
      regs.forEach((r) => r.active?.postMessage({ type: 'orbit-unregister' }));
      await Promise.all(regs.map((r) => r.unregister()));
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      setState('removed');
    } catch {
      setState('registered');
    }
  }

  if (state === 'unknown') return null;

  if (state === 'none') {
    return (
      <p className="muted mt-2 text-xs" data-sw-state="none">
        No service worker is installed in this browser. Orbit works exactly as it
        always has; offline it shows the browser’s own error rather than a page
        that explains itself.
      </p>
    );
  }

  if (state === 'removed') {
    return (
      <p className="muted mt-2 text-xs" data-sw-state="removed">
        Removed, and its caches with it. Reload and it will install again — to
        keep it off, use your browser’s site settings.
      </p>
    );
  }

  return (
    <div className="mt-2" data-sw-state="registered">
      <p className="muted text-xs">
        A service worker is installed. It holds the offline page and this build’s
        static files — never a page rendered for you, because a stored copy of
        one could be shown to whoever opens this browser next.
      </p>
      <button
        type="button"
        onClick={remove}
        disabled={state === 'removing'}
        className="hairline mt-2 rounded border px-2.5 py-1 text-xs"
      >
        {state === 'removing' ? 'Removing…' : 'Remove it and empty its caches'}
      </button>
    </div>
  );
}
