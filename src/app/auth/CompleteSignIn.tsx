'use client';

import { useEffect, useRef, useState } from 'react';
import { completeSignInAction } from './actions';

/**
 * The last step of a magic link, which has to happen in the browser.
 *
 * Supabase's default email template sends people to
 * `…/auth/callback#access_token=…&refresh_token=…`. A URL *fragment* is never
 * sent to a server — that is what a fragment is — so no route handler can read
 * it. This component reads it, hands the tokens to a server action, and the
 * action asks Supabase whether they are real before anything is trusted.
 *
 * The tokens are put straight into a form and submitted, so they never reach
 * React state and never end up in a serialised payload on the page. The
 * fragment is cleared from the address bar in the same tick, because a
 * screenshot of a URL with an access token in it is a shared session.
 *
 * A project whose email template uses `{{ .TokenHash }}` instead lands here
 * with `?token_hash=…&type=…`, which the server already read; that path renders
 * the same form with a button and does not need this component to do anything.
 */
export function CompleteSignIn({ next }: { next: string }) {
  const form = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<'reading' | 'sending' | 'nothing'>('reading');

  useEffect(() => {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token') ?? '';
    const refreshToken = params.get('refresh_token') ?? '';

    if (!accessToken) {
      setState('nothing');
      return;
    }

    const el = form.current;
    if (!el) return;
    (el.elements.namedItem('access_token') as HTMLInputElement).value = accessToken;
    (el.elements.namedItem('refresh_token') as HTMLInputElement).value = refreshToken;

    history.replaceState(null, '', window.location.pathname + window.location.search);
    setState('sending');
    el.requestSubmit();
  }, []);

  return (
    <>
      <form ref={form} action={completeSignInAction} aria-label="Finish signing in">
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="access_token" defaultValue="" />
        <input type="hidden" name="refresh_token" defaultValue="" />
      </form>
      <p className="muted text-xs">
        {state === 'sending'
          ? 'Signing you in…'
          : state === 'reading'
            ? 'Reading the link…'
            : 'That link carried nothing to sign in with. It may have been used already, or it may have expired — ask for a new one.'}
      </p>
    </>
  );
}
