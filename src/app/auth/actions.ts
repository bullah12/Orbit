'use server';

import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { usesDevAuth } from '@/lib/auth';
import { safeNextPath } from '@/lib/auth/session';
import {
  clearSession,
  endSession,
  persistSession,
  sendMagicLink,
  sessionFromTokens,
  signInWithPassword,
  signUpWithPassword,
  supabaseIsConfigured,
  verifyEmailToken,
  type AuthResult,
} from '@/lib/auth/supabase';

/**
 * The things a sign-in screen does.
 *
 * Every one of them is a refusal when `AUTH_PROVIDER=dev`, because under dev
 * auth there is nothing to sign in to: identity is a cookie naming a seeded
 * profile and the sidebar's switcher is the whole story. A form that appeared
 * to sign you in and then did nothing would be worse than a sentence saying so.
 *
 * A failure never throws to a 500. It comes back to the same screen with a
 * sentence on the URL, which is the pattern every other form in Orbit uses.
 */

function toSignIn(params: Record<string, string>): never {
  redirect(`/auth/signin?${new URLSearchParams(params).toString()}`);
}

function toSignUp(params: Record<string, string>): never {
  redirect(`/auth/signup?${new URLSearchParams(params).toString()}`);
}

/**
 * `safeNextPath` has already refused anything that is not an in-app path, which
 * is the check that matters; the cast is what tells the typed-routes checker a
 * runtime-validated string is a route.
 */
function toNext(next: string): never {
  redirect(next as Route);
}

/** A configured provider, or a sentence explaining why there is not one. */
function refuseIfUnavailable(onSignUp = false): void {
  const to = onSignUp ? toSignUp : toSignIn;
  if (usesDevAuth()) {
    to({
      error:
        'This build runs with AUTH_PROVIDER=dev, so there are no accounts to sign in to. Use the switcher in the sidebar.',
    });
  }
  if (!supabaseIsConfigured()) {
    to({
      error:
        'AUTH_PROVIDER=supabase is selected but SUPABASE_URL and SUPABASE_ANON_KEY are not set, so there is no project to sign in to.',
    });
  }
}

/**
 * Where Supabase should send somebody back to.
 *
 * `APP_URL` is what a deployment sets. The origin of the request is not used:
 * a redirect target that follows a request header is a redirect target somebody
 * else can choose.
 */
function callbackUrl(next: string): string {
  const base = process.env.APP_URL?.trim().replace(/\/+$/, '') || 'http://localhost:3000';
  const query = next && next !== '/' ? `?next=${encodeURIComponent(next)}` : '';
  return `${base}/auth/callback${query}`;
}

function sentence<T>(result: AuthResult<T>): string {
  return result.ok ? '' : result.error;
}

export async function signInAction(formData: FormData) {
  refuseIfUnavailable();

  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = safeNextPath(String(formData.get('next') ?? '/'));

  if (!email || !password) toSignIn({ error: 'An email address and a password, please.', next });

  const result = await signInWithPassword(email, password);
  if (!result.ok) toSignIn({ error: sentence(result), next, email });

  await persistSession(result.value);
  revalidatePath('/', 'layout');
  toNext(next);
}

export async function magicLinkAction(formData: FormData) {
  refuseIfUnavailable();

  const email = String(formData.get('email') ?? '').trim();
  const next = safeNextPath(String(formData.get('next') ?? '/'));
  if (!email) toSignIn({ error: 'An email address, please.', next });

  const result = await sendMagicLink(email, callbackUrl(next));
  if (!result.ok) toSignIn({ error: sentence(result), next, email });

  toSignIn({ sent: email, next });
}

export async function signUpAction(formData: FormData) {
  refuseIfUnavailable(true);

  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const displayName = String(formData.get('displayName') ?? '').trim();
  const next = safeNextPath(String(formData.get('next') ?? '/'));

  if (!email || !password) toSignUp({ error: 'An email address and a password, please.', next });
  if (password.length < 8) {
    toSignUp({ error: 'Eight characters or more, please.', next, email, displayName });
  }

  const result = await signUpWithPassword(email, password, displayName, callbackUrl(next));
  if (!result.ok) toSignUp({ error: sentence(result), next, email, displayName });

  if (result.value.confirmationRequired || !result.value.session) {
    toSignIn({ sent: email, next });
  }

  await persistSession(result.value.session);
  revalidatePath('/', 'layout');
  toNext(next);
}

/**
 * Finish a magic link.
 *
 * Two shapes arrive here and both are a *claim* until Supabase confirms them:
 * a `token_hash` (a project whose email template uses `{{ .TokenHash }}`), or a
 * pair of tokens the browser read out of the URL fragment (the default
 * template, which the server never sees — see `src/app/auth/CompleteSignIn.tsx`).
 */
export async function completeSignInAction(formData: FormData) {
  refuseIfUnavailable();

  const next = safeNextPath(String(formData.get('next') ?? '/'));
  const tokenHash = String(formData.get('token_hash') ?? '').trim();
  const type = String(formData.get('type') ?? '').trim() || 'magiclink';
  const accessToken = String(formData.get('access_token') ?? '').trim();
  const refreshToken = String(formData.get('refresh_token') ?? '').trim();

  if (!tokenHash && !accessToken) {
    toSignIn({ error: 'That link carried nothing to sign in with. Ask for a new one.', next });
  }

  const result = tokenHash
    ? await verifyEmailToken(tokenHash, type)
    : await sessionFromTokens(accessToken, refreshToken);

  if (!result.ok) toSignIn({ error: sentence(result), next });

  await persistSession(result.value);
  revalidatePath('/', 'layout');
  toNext(next);
}

/**
 * Sign out.
 *
 * A POST from a button on a page, never a link: a GET that ends a session can
 * be triggered by an image tag on somebody else's site. Under dev auth it does
 * nothing but say so — there is no session to end.
 */
export async function signOutAction() {
  if (usesDevAuth()) {
    toSignIn({ error: 'Nothing to sign out of: this build runs with AUTH_PROVIDER=dev.' });
  }

  try {
    await endSession();
  } catch {
    // Not configured, or Supabase unreachable. The cookies are the session as
    // far as Orbit is concerned, so drop them and call it signed out.
    await clearSession();
  }
  revalidatePath('/', 'layout');
  toSignIn({ signedOut: '1' });
}
