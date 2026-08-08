import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { previewInvite } from '@/lib/queries/invites';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import {
  ROLE_LABEL,
  ROLE_MEANING,
  expiresInWords,
  inviteSentence,
  isInviteRole,
  isInviteStatus,
  isOpen,
} from '@/lib/invites';
import { acceptSpaceInvite, declineSpaceInvite } from '@/app/actions';

export const dynamic = 'force-dynamic';

/**
 * An invitation, as the person who was sent the link sees it.
 *
 * Everything on this page comes from `orbit.space_invite(token, 'preview')`. The
 * policies on `space_invites` are admin-only in both directions, so there is no
 * query the invitee could run instead — that is the whole reason the function
 * exists, and it is the single SECURITY DEFINER exception this work adds.
 *
 * **Every refusal is a sentence, and none of them is a 403.** An expired link, a
 * used link, a link addressed to somebody else and a link that was never issued
 * each say what happened and what to do about it. A permission error page would
 * be both wrong — being refused an invitation is an ordinary outcome — and
 * useless, because it tells you nothing you can act on.
 */
export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ outcome?: string }>;
}) {
  const { token } = await params;
  const { outcome } = await searchParams;
  const user = await requireUser();

  const view = await previewInvite(user.id, decodeURIComponent(token));
  // The outcome of a just-pressed button, if there was one. It is a claim from
  // the URL, so it is only ever used to pick a sentence — never to decide
  // whether anything happened.
  const said = outcome && isInviteStatus(outcome) ? outcome : null;

  const context = {
    spaceName: view.spaceName,
    invitedEmail: view.invitedEmail,
    role: view.role,
  };
  const open = isOpen(view.status);
  const role = view.role && isInviteRole(view.role) ? view.role : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-5 py-10">
      <h1 className="text-xl font-semibold">An invitation</h1>

      {said && said !== 'ok' && (
        <p
          role="status"
          id="invite-outcome"
          className="mt-3 rounded px-3 py-2 text-xs"
          style={
            said === 'accepted'
              ? { background: 'var(--success-bg)', color: 'var(--success)' }
              : { background: 'var(--bg-sunken)', color: 'var(--text-muted)' }
          }
        >
          {inviteSentence(said, context)}
        </p>
      )}

      <div className="surface mt-3 p-4">
        {view.spaceName && view.spaceId ? (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SpaceIndicator
              space={{
                id: view.spaceId,
                name: view.spaceName,
                shortLabel: view.spaceShortLabel ?? view.spaceName,
                colour: view.spaceColour ?? 'slate',
                icon: view.spaceIcon ?? 'circle',
              }}
              size="md"
            />
            <span className="text-sm font-medium">{view.spaceName}</span>
            {role && (
              <span className="chip hairline border">
                <Icon name="user" size={10} />
                {ROLE_LABEL[role]}
              </span>
            )}
          </div>
        ) : null}

        <p id="invite-sentence" className="text-sm">
          {inviteSentence(view.status, context)}
        </p>

        {open && role && (
          <>
            <p className="muted mt-2 text-xs">{ROLE_MEANING[role]}</p>
            {view.expiresAt && (
              <p className="faint mt-1 text-2xs">
                This invitation expires {expiresInWords(view.expiresAt)}.
              </p>
            )}
            <p className="faint mt-1 text-2xs">
              You are signed in as {user.displayName} ({user.email}), and that is
              who would join.
            </p>

            <div className="mt-3 flex gap-2">
              <form action={acceptSpaceInvite}>
                <input type="hidden" name="token" value={token} />
                <button
                  type="submit"
                  className="hairline rounded border px-3 py-1.5 text-sm"
                  style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
                >
                  Accept and join {view.spaceName}
                </button>
              </form>
              <form action={declineSpaceInvite}>
                <input type="hidden" name="token" value={token} />
                <button type="submit" className="hairline rounded border px-3 py-1.5 text-sm">
                  Decline
                </button>
              </form>
            </div>
            <p className="faint mt-2 text-2xs">
              Declining changes nothing and tells nobody. The link stays live
              until it expires or is revoked, so you can accept later.
            </p>
          </>
        )}

        {!open && (
          <p className="muted mt-3 text-xs">
            <Link href="/spaces">See the spaces you are already in</Link>.
          </p>
        )}
      </div>
    </div>
  );
}
