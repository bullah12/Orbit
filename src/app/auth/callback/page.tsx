import Link from 'next/link';
import { safeNextPath } from '@/lib/auth/session';
import { AuthShell, Notice, SubmitButton } from '../AuthShell';
import { CompleteSignIn } from '../CompleteSignIn';
import { completeSignInAction } from '../actions';

export const dynamic = 'force-dynamic';

/**
 * Where a magic link lands.
 *
 * Three shapes arrive here and each is handled where it can be:
 *
 *   `?error=…`        — Supabase refused before it got to us. Say what it said.
 *   `?token_hash=…`   — readable on the server; one button finishes it, so the
 *                       flow works with JavaScript switched off.
 *   `#access_token=…` — a fragment, which no server ever sees. `CompleteSignIn`
 *                       reads it in the browser and posts it to the same action.
 *
 * Nothing here trusts what it was handed. Both paths end at
 * `completeSignInAction`, which asks Supabase who the token belongs to.
 */
export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string;
    token_hash?: string;
    type?: string;
    error?: string;
    error_description?: string;
  }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const tokenHash = params.token_hash?.trim() ?? '';
  const type = params.type?.trim() || 'magiclink';
  const refused = params.error_description || params.error;

  return (
    <AuthShell
      title="Finishing sign-in"
      lead="One step left."
      footer={<Link href="/auth/signin">Back to sign in</Link>}
    >
      {refused ? (
        <Notice tone="warning">{refused}</Notice>
      ) : tokenHash ? (
        <form action={completeSignInAction} aria-label="Finish signing in">
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="token_hash" value={tokenHash} />
          <input type="hidden" name="type" value={type} />
          <p className="muted mb-3 text-xs">
            This link is still a claim until Supabase confirms it. Press the
            button and it will be checked.
          </p>
          <SubmitButton>Finish signing in</SubmitButton>
        </form>
      ) : (
        <CompleteSignIn next={next} />
      )}
    </AuthShell>
  );
}
