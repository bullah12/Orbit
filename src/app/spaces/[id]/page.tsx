import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { listSpaces, spaceContents, type SpaceContents } from '@/lib/queries/spaces';
import { listInvites, listMembers } from '@/lib/queries/invites';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { formatDateTime } from '@/lib/format';
import {
  DEFAULT_EXPIRY_DAYS,
  EXPIRY_CHOICES,
  INVITE_ROLES,
  ROLE_LABEL,
  ROLE_MEANING,
  expiresInWords,
  invitePath,
  isInviteRole,
} from '@/lib/invites';
import {
  createSpaceInvite,
  deleteSpaceAction,
  removeSpaceMember,
  renameSpaceAction,
  revokeSpaceInvite,
} from '@/app/actions';
import { SubmitButton } from '@/components/SubmitButton';

export const dynamic = 'force-dynamic';

/**
 * One space: who is in it, who has been invited, and the two admin operations.
 *
 * The invitation link is shown exactly once, immediately after it is made,
 * because only its hash is stored — there is nowhere to read it back from. The
 * screen says so rather than leaving somebody to discover it by reloading.
 */
export default async function SpacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    token?: string;
    error?: string;
    joined?: string;
    revoked?: string;
    removed?: string;
    delete?: string;
    renamed?: string;
  }>;
}) {
  const { id } = await params;
  const { token, error, joined, revoked, removed, renamed, delete: del } = await searchParams;
  const user = await requireUser();

  const space = (await listSpaces(user.id)).find((s) => s.id === id);
  // Not a 403. A space you are not in is a space that does not exist as far as
  // you are concerned — the same answer every other detail page gives.
  if (!space) notFound();

  const isAdmin = space.role === 'owner' || space.role === 'admin';
  // Only counted when the confirmation is actually on screen: six counts on
  // every visit to a page about membership would be six queries nobody asked
  // for.
  const confirmingDelete = del === '1' && space.role === 'owner' && !space.isProtected;
  const [members, invites, contents] = await Promise.all([
    listMembers(user.id, id),
    isAdmin ? listInvites(user.id, id) : Promise.resolve([]),
    confirmingDelete
      ? spaceContents(user.id, id)
      : Promise.resolve({ tasks: 0, notes: 0, events: 0, people: 0, places: 0, members: 0 }),
  ]);

  const host = (await headers()).get('host');
  const origin = process.env.APP_URL?.trim().replace(/\/+$/, '') || (host ? `http://${host}` : '');
  const inviteUrl = token ? `${origin}${invitePath(token)}` : null;

  const active = members.filter((m) => m.status === 'active');
  const gone = members.filter((m) => m.status !== 'active');
  const pending = invites.filter((i) => !i.acceptedAt && new Date(i.expiresAt) > new Date());

  return (
    <div className="flex min-h-screen flex-col">
      <header className="hairline border-b px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <SpaceIndicator space={space} size="md" />
          <h1 className="text-lg font-semibold">{space.name}</h1>
          <span className="faint text-xs">
            {active.length} {active.length === 1 ? 'person' : 'people'}
            {isAdmin && pending.length > 0 ? `, ${pending.length} invited` : ''}
          </span>
        </div>
        <p className="muted mt-0.5 text-xs">
          {isAdmin
            ? 'You administer this space, so you can invite people and remove them.'
            : 'You can see who is here. Inviting and removing people is an admin’s job.'}
        </p>
        <p className="faint mt-1 text-xs">
          <Link href="/spaces">All spaces</Link>
        </p>
      </header>

      {error && (
        <p
          role="alert"
          id="space-error"
          className="hairline border-b px-5 py-2 text-xs"
          style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}
        >
          {error}
        </p>
      )}
      {joined && (
        <p
          role="status"
          className="hairline border-b px-5 py-2 text-xs"
          style={{ background: 'var(--success-bg)', color: 'var(--success)' }}
        >
          You have joined {space.name}. It is in your sidebar now.
        </p>
      )}
      {revoked && (
        <p role="status" className="hairline muted border-b px-5 py-2 text-xs">
          That invitation has been revoked. Its link stops working immediately;
          the row stays here as the record of what was offered.
        </p>
      )}
      {renamed && (
        <p role="status" className="hairline muted border-b px-5 py-2 text-xs">
          Renamed. The indicator changes everywhere it appears.
        </p>
      )}
      {removed && (
        <p role="status" className="hairline muted border-b px-5 py-2 text-xs">
          They have left the space. Nothing they made was deleted — it belongs to
          the space, and they simply cannot see it any more.
        </p>
      )}

      {inviteUrl && (
        <section
          className="hairline border-b px-5 py-4"
          aria-labelledby="new-invite"
          style={{ background: 'var(--bg-sunken)' }}
        >
          <h2 id="new-invite" className="flex items-center gap-1.5 text-sm font-semibold">
            <Icon name="link" size={13} className="muted" />
            The invitation link, shown once
          </h2>
          <p className="muted mt-1 max-w-2xl text-xs">
            Copy it now and send it however you like. Only its fingerprint is
            stored, so this is the one and only time it can be displayed —
            reload this page and it is gone for good. If you lose it, revoke the
            invitation and make another.
          </p>
          <input
            className="input mt-2 font-mono text-xs"
            readOnly
            value={inviteUrl}
            aria-label="Invitation link"
          />
        </section>
      )}

      <section className="px-5 py-4" aria-labelledby="members-heading">
        <h2 id="members-heading" className="text-sm font-semibold">
          People
        </h2>
        <ul className="surface mt-2 divide-y" style={{ borderColor: 'var(--line)' }}>
          {active.map((m) => (
            <li key={m.userId} className="row justify-between">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm">
                  {m.displayName}
                  {m.userId === user.id && <span className="faint text-2xs"> — you</span>}
                </span>
                <span className="faint truncate text-2xs">{m.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="chip hairline border">
                  <Icon name={m.isSpaceOwner ? 'house' : 'user'} size={10} />
                  {m.isSpaceOwner
                    ? 'Owner'
                    : isInviteRole(m.role)
                      ? ROLE_LABEL[m.role]
                      : m.role}
                </span>
                {isAdmin && !m.isSpaceOwner && (
                  <form action={removeSpaceMember}>
                    <input type="hidden" name="spaceId" value={id} />
                    <input type="hidden" name="memberId" value={m.userId} />
                    <button
                      type="submit"
                      className="hairline rounded border px-2 py-0.5 text-2xs"
                      style={{ color: 'var(--danger)' }}
                    >
                      Remove from {space.shortLabel}
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
        {gone.length > 0 && (
          <details className="mt-2 text-xs">
            <summary className="muted cursor-pointer">
              {gone.length} {gone.length === 1 ? 'person has' : 'people have'} left this space
            </summary>
            <ul className="mt-1">
              {gone.map((m) => (
                <li key={m.userId} className="faint py-0.5">
                  {m.displayName} — {m.status}. Their row is kept, so it is a
                  record rather than a gap.
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {isAdmin && (
        <>
          <section className="px-5 pb-4" aria-labelledby="invite-heading">
            <h2 id="invite-heading" className="text-sm font-semibold">
              Invite somebody
            </h2>
            <form
              action={createSpaceInvite}
              aria-label="Invite somebody to this space"
              className="surface mt-2 flex flex-wrap items-end gap-3 p-3"
            >
              <input type="hidden" name="spaceId" value={id} />

              <div className="min-w-40 flex-1">
                <label htmlFor="invite-role" className="section-label mb-1 block">
                  Role
                </label>
                <select id="invite-role" name="role" className="input" defaultValue="member">
                  {INVITE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABEL[role]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="min-w-32">
                <label htmlFor="invite-days" className="section-label mb-1 block">
                  Good for
                </label>
                <select
                  id="invite-days"
                  name="days"
                  className="input"
                  defaultValue={String(DEFAULT_EXPIRY_DAYS)}
                >
                  {EXPIRY_CHOICES.map((d) => (
                    <option key={d} value={d}>
                      {d} {d === 1 ? 'day' : 'days'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="min-w-56 flex-1">
                <label htmlFor="invite-email" className="section-label mb-1 block">
                  For one person only (optional)
                </label>
                <input
                  id="invite-email"
                  name="invitedEmail"
                  type="email"
                  className="input"
                  placeholder="somebody@example.com"
                />
              </div>

              <button
                type="submit"
                className="hairline rounded border px-3 py-1.5 text-sm btn-primary"
              >
                Make a link
              </button>
            </form>
            <p className="faint mt-1 max-w-2xl text-2xs">
              Name an address and only the person signed in with it can accept.
              Leave it empty and the link works for whoever holds it — which is
              convenient, and is why it expires. Either way the invitation grants
              exactly the role above and nothing more:{' '}
              {ROLE_MEANING.free_busy.toLowerCase()}
            </p>
          </section>

          <section className="px-5 pb-6" aria-labelledby="invites-heading">
            <h2 id="invites-heading" className="text-sm font-semibold">
              Invitations
            </h2>
            {invites.length === 0 ? (
              <p className="muted mt-1 text-xs">None yet.</p>
            ) : (
              <ul className="surface mt-2 divide-y" style={{ borderColor: 'var(--line)' }}>
                {invites.map((i) => {
                  const expired = new Date(i.expiresAt) <= new Date();
                  return (
                    <li key={i.id} className="row justify-between">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm">
                          {i.invitedEmail ?? 'Anybody with the link'}
                          <span className="faint text-2xs">
                            {' '}
                            — {isInviteRole(i.role) ? ROLE_LABEL[i.role] : i.role}
                          </span>
                        </span>
                        <span className="faint text-2xs">
                          {i.acceptedAt
                            ? `Accepted by ${i.acceptedByName ?? 'somebody'} on ${formatDateTime(i.acceptedAt)}`
                            : expired
                              ? 'Expired or revoked'
                              : `Expires ${expiresInWords(i.expiresAt)}`}
                        </span>
                      </div>
                      {!i.acceptedAt && !expired && (
                        <form action={revokeSpaceInvite}>
                          <input type="hidden" name="spaceId" value={id} />
                          <input type="hidden" name="inviteId" value={i.id} />
                          <button
                            type="submit"
                            className="hairline rounded border px-2 py-0.5 text-2xs"
                          >
                            Revoke
                          </button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {isAdmin && (
        <section className="hairline border-t px-5 py-4" aria-labelledby="rename-space">
          <h2 id="rename-space" className="faint mb-2 text-2xs font-semibold uppercase tracking-wider">
            Name
          </h2>
          <form action={renameSpaceAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="spaceId" value={id} />
            <div className="flex flex-col gap-1">
              <label htmlFor="space-rename" className="faint text-2xs">
                What it is called
              </label>
              <input
                id="space-rename"
                name="name"
                type="text"
                required
                maxLength={80}
                defaultValue={space.name}
                className="input"
                style={{ width: '16rem' }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="space-relabel" className="faint text-2xs">
                On the chip
              </label>
              <input
                id="space-relabel"
                name="shortLabel"
                type="text"
                maxLength={12}
                defaultValue={space.shortLabel}
                className="input"
                style={{ width: '8rem' }}
              />
            </div>
            <SubmitButton className="hairline rounded border px-3 py-1.5 text-xs">
              Save the name
            </SubmitButton>
          </form>
          {space.isProtected && (
            <p className="faint mt-2 max-w-2xl text-2xs">
              This one cannot be deleted, but it is yours to name. Call it
              anything.
            </p>
          )}
        </section>
      )}

      {space.role === 'owner' && (
        <section className="hairline border-t px-5 py-4" aria-labelledby="delete-space">
          <h2 id="delete-space" className="faint mb-2 text-2xs font-semibold uppercase tracking-wider">
            Delete
          </h2>

          {space.isProtected ? (
            <p className="muted max-w-2xl text-xs">
              <Icon name="lock" size={11} className="inline" /> {space.name} cannot
              be deleted. It is the space that guarantees you always have
              somewhere to write, so the database refuses it — not the button.
              You can rename it, recolour it, share it and move anything in it
              elsewhere; what you cannot do is end up with nowhere to put the
              next thing you think of.
            </p>
          ) : confirmingDelete ? (
            <div className="max-w-2xl">
              <p className="text-xs" style={{ color: 'var(--danger)' }}>
                Deleting {space.name} deletes everything in it. There is no undo
                and nothing is archived.
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {contentLines(contents).map((line) => (
                  <li key={line} className="hairline rounded border px-2 py-1 text-2xs">
                    {line}
                  </li>
                ))}
              </ul>
              {contents.members > 1 && (
                <p className="mt-2 text-2xs" style={{ color: 'var(--warning)' }}>
                  {contents.members - 1} other{' '}
                  {contents.members === 2 ? 'person is' : 'people are'} in this
                  space. They lose all of it too, and they are not asked.
                </p>
              )}

              {/* Typing the name, for the same reason the move confirmation
                  lists who gains and loses access: a destructive step needs an
                  action nobody performs by accident. */}
              <form action={deleteSpaceAction} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="spaceId" value={id} />
                <div className="flex flex-col gap-1">
                  <label htmlFor="confirm-name" className="faint text-2xs">
                    Type <strong>{space.name}</strong> to confirm
                  </label>
                  <input
                    id="confirm-name"
                    name="confirmName"
                    type="text"
                    autoComplete="off"
                    className="input"
                    style={{ width: '14rem' }}
                  />
                </div>
                <SubmitButton className="hairline rounded border px-3 py-1.5 text-xs font-medium btn-danger">
                  Delete {space.name} and everything in it
                </SubmitButton>
                <Link href={`/spaces/${id}`} className="faint text-xs">
                  Keep it
                </Link>
              </form>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={`/spaces/${id}?delete=1`}
                className="btn hairline rounded border px-3 py-1.5 text-xs font-medium btn-danger"
              >
                Delete this space
              </Link>
              <span className="faint text-xs">
                Permanent, and it takes everything in it with it. You will be
                shown what that is first.
              </span>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** The counts, as phrases, with the empty ones left out. */
function contentLines(c: SpaceContents): string[] {
  const parts: [number, string, string][] = [
    [c.tasks, 'task', 'tasks'],
    [c.notes, 'note', 'notes'],
    [c.events, 'event', 'events'],
    [c.people, 'person', 'people'],
    [c.places, 'place', 'places'],
  ];
  const lines = parts
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  return lines.length > 0 ? lines : ['nothing in it yet'];
}
