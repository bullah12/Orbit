import Link from 'next/link';
import { getCurrentUser, usesDevAuth } from '@/lib/auth';
import { AuthShell, Notice, SubmitButton } from '../AuthShell';
import { signOutAction } from '../actions';

export const dynamic = 'force-dynamic';

/**
 * Sign out, confirmed by a button rather than done by arriving.
 *
 * A GET that ends a session can be fired by an image tag on somebody else's
 * page. This is a POST from a form, which is the same reason every destructive
 * action in Orbit is a button and not a link.
 */
export default async function SignOutPage() {
  const dev = usesDevAuth();
  const user = await getCurrentUser();

  return (
    <AuthShell
      title="Sign out"
      lead={user ? `You are signed in as ${user.displayName}.` : 'You are not signed in.'}
      footer={<Link href="/">Back to Today</Link>}
    >
      {dev ? (
        <Notice tone="warning">
          This build runs with <code>AUTH_PROVIDER=dev</code>: identity is a
          cookie naming a seeded profile, so there is no session to end. Use the
          switcher in the sidebar to become somebody else.
        </Notice>
      ) : (
        <form action={signOutAction} aria-label="Sign out">
          <p className="muted mb-3 text-xs">
            This ends the session on this browser and tells Supabase the session
            is over. Anything queued offline stays in this browser until you sign
            in again.
          </p>
          <SubmitButton>Sign out</SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}
