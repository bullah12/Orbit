import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, usesDevAuth } from '@/lib/auth';
import { safeNextPath } from '@/lib/auth/session';
import { AuthShell, Field, Notice, SubmitButton } from '../AuthShell';
import { signUpAction } from '../actions';

export const dynamic = 'force-dynamic';

/**
 * Create an account.
 *
 * The display name typed here becomes `user_metadata.display_name`, which the
 * trigger in migration 0012 copies into `public.profiles.display_name` — so the
 * name somebody types on this form is the name that appears on every row they
 * own. If they leave it empty the trigger falls back to the email's local part;
 * a profile with a blank display name would render as a gap.
 *
 * A new account is a member of nothing. That is the correct starting state: a
 * space is made or joined through an invite, and neither happens by signing up.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; email?: string; displayName?: string }>;
}) {
  const { error, next: rawNext, email, displayName } = await searchParams;
  const next = safeNextPath(rawNext);
  const dev = usesDevAuth();

  if (!dev) {
    const user = await getCurrentUser();
    if (user) redirect('/');
  }

  return (
    <AuthShell
      title="Create an account"
      lead={
        dev
          ? 'This build is not using accounts.'
          : 'An email address, a password, and what you would like to be called.'
      }
      footer={
        dev ? null : (
          <>
            Already have one? <Link href="/auth/signin">Sign in</Link>.
          </>
        )
      }
    >
      {error && <Notice tone="warning">{error}</Notice>}

      {dev ? (
        <div className="text-xs">
          <p className="mb-2">
            <strong>AUTH_PROVIDER=dev.</strong> There are three seeded people and
            no way to add a fourth from a screen — the switcher in the sidebar is
            the whole of identity here.
          </p>
          <p>
            <Link href="/">Back to Today</Link>
          </p>
        </div>
      ) : (
        <form action={signUpAction} aria-label="Create an account">
          <input type="hidden" name="next" value={next} />
          <Field
            label="Your name"
            name="displayName"
            defaultValue={displayName}
            autoComplete="name"
            hint="What the people you share a space with will see."
          />
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
            autoComplete="new-password"
            hint="Eight characters or more."
          />
          <SubmitButton>Create account</SubmitButton>
          <p className="faint mt-2 text-2xs">
            If the project requires a confirmed email address, nothing is signed
            in until you follow the link that arrives.
          </p>
        </form>
      )}
    </AuthShell>
  );
}
