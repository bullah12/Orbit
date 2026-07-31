import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, usesDevAuth } from '@/lib/auth';
import { safeNextPath } from '@/lib/auth/session';
import { supabaseIsConfigured } from '@/lib/auth/supabase';
import { AuthShell, Field, Notice, SubmitButton } from '../AuthShell';
import { magicLinkAction, signInAction } from '../actions';

export const dynamic = 'force-dynamic';

/**
 * Sign in. Email and password, or a magic link.
 *
 * No OAuth buttons. Each provider is a console configuration nobody in this
 * repository can perform or verify, and a button that cannot work is worse than
 * no button.
 *
 * Under `AUTH_PROVIDER=dev` this page still renders — it is a route, and a 404
 * would be a lie — but it says what is actually running and offers no form to
 * fill in, because there is nothing behind it.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    sent?: string;
    signedOut?: string;
    next?: string;
    email?: string;
  }>;
}) {
  const { error, sent, signedOut, next: rawNext, email } = await searchParams;
  const next = safeNextPath(rawNext);
  const dev = usesDevAuth();

  if (!dev) {
    const user = await getCurrentUser();
    if (user) redirect('/');
  }

  return (
    <AuthShell
      title="Sign in"
      lead={
        dev
          ? 'This build is not using accounts.'
          : 'With your email address and password, or a link sent to your inbox.'
      }
      footer={
        dev ? null : (
          <>
            No account yet? <Link href="/auth/signup">Create one</Link>.
          </>
        )
      }
    >
      {error && <Notice tone="warning">{error}</Notice>}
      {signedOut && <Notice tone="success">You are signed out.</Notice>}
      {sent && (
        <Notice tone="success">
          If {sent} has an account, a sign-in link is on its way to it. The link
          expires; ask for another if it does.
        </Notice>
      )}

      {dev ? (
        <div className="text-xs">
          <p className="mb-2">
            <strong>AUTH_PROVIDER=dev.</strong> Identity here is a cookie naming
            a seeded profile, so there is nothing to sign in to and no password
            to get wrong. Switch between the seeded people in the sidebar.
          </p>
          <p className="muted">
            Set <code>AUTH_PROVIDER=supabase</code>, <code>SUPABASE_URL</code>{' '}
            and <code>SUPABASE_ANON_KEY</code> to make this page do something.
          </p>
          <p className="mt-3">
            <Link href="/">Back to Today</Link>
          </p>
        </div>
      ) : (
        <form action={signInAction} aria-label="Sign in">
          <input type="hidden" name="next" value={next} />
          <Field
            label="Email"
            name="email"
            type="email"
            defaultValue={email}
            autoComplete="email"
            required
          />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
          />
          <SubmitButton>Sign in</SubmitButton>

          <p className="faint my-3 text-center text-2xs">or</p>

          <SubmitButton quiet formAction={magicLinkAction}>
            Email me a link instead
          </SubmitButton>
          <p className="faint mt-2 text-2xs">
            A link signs you in without a password. It only works for an account
            that already exists — it will not create one.
          </p>

          {!supabaseIsConfigured() && (
            <p className="muted mt-3 text-2xs">
              This server has no <code>SUPABASE_URL</code> or{' '}
              <code>SUPABASE_ANON_KEY</code> set, so either button will come back
              with a sentence saying exactly that rather than an error page.
            </p>
          )}
        </form>
      )}
    </AuthShell>
  );
}
