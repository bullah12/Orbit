import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listSpaces } from '@/lib/queries/spaces';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { ROLE_LABEL, ROLE_MEANING, isInviteRole } from '@/lib/invites';
import { createSpaceAction } from '@/app/actions';
import { SPACE_KINDS } from '@/lib/spaces';

export const dynamic = 'force-dynamic';

/**
 * Who is in which space.
 *
 * A space is the unit of sharing in Orbit — `spaces.id` is the `space_id` on
 * every space-scoped table — so this is the only screen where "who can see my
 * things" is a question with an answer on it.
 */
export default async function SpacesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const user = await requireUser();
  const spaces = await listSpaces(user.id);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="hairline border-b px-5 py-4">
        <h1 className="text-lg font-semibold">Spaces</h1>
        <p className="muted mt-0.5 text-xs">
          Sharing in Orbit is by space, not by account: everything you make lives
          in one, and the people in that space are the people who can see it.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="hairline border-b px-5 py-2 text-xs"
          style={{ background: 'var(--c-amber-bg)', color: 'var(--c-amber)' }}
        >
          {error}
        </p>
      )}

      {/* First, not last. An account with no space cannot create a task, a note
          or an event anywhere in Orbit — capture has nowhere to write and says
          so — so on an empty account this form is the whole page and everything
          below it is explanation. */}
      <section className="hairline border-b px-5 py-4" aria-labelledby="new-space-heading">
        <h2 id="new-space-heading" className="text-sm font-semibold">
          {spaces.length === 0 ? 'Make your first space' : 'New space'}
        </h2>
        <p className="muted mt-0.5 max-w-2xl text-xs">
          {spaces.length === 0
            ? 'Everything in Orbit lives in a space, so nothing can be created until there is one. Make one for yourself now — you can invite people to it, or make another for the household, whenever you like.'
            : 'A second space is a second audience, not a second folder. Make one when a different set of people should see what is in it.'}
        </p>

        <form action={createSpaceAction} className="mt-3 flex flex-col gap-3">
          {next && <input type="hidden" name="next" value={next} />}

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="space-name" className="sr-only">
              What is this space called?
            </label>
            <input
              id="space-name"
              name="name"
              type="text"
              required
              maxLength={80}
              autoFocus={spaces.length === 0}
              placeholder={spaces.length === 0 ? 'Home' : 'Weekend cottage'}
              className="input"
              style={{ width: '18rem' }}
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm"
              style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
            >
              <Icon name="plus" size={13} />
              Create the space
            </button>
          </div>

          <fieldset className="flex flex-wrap items-center gap-3">
            <legend className="faint text-2xs font-semibold uppercase tracking-wider">
              Who it is for
            </legend>
            {SPACE_KINDS.map((k, i) => (
              <label key={k.kind} className="flex items-center gap-1.5 text-xs">
                <input type="radio" name="kind" value={k.kind} defaultChecked={i === 0} />
                <span
                  className="inline-flex items-center"
                  style={{ color: `var(--c-${k.colour})` }}
                >
                  <Icon name={k.icon} size={12} />
                </span>
                {k.label}
              </label>
            ))}
          </fieldset>
          <p className="faint text-2xs">
            You will be its owner. The kind picks the colour and icon of its
            indicator, and nothing else — who can see the space is decided by who
            you invite to it.
          </p>
        </form>
      </section>

      <section className="px-5 py-4">
        <ul className="surface divide-y" style={{ borderColor: 'var(--line)' }}>
          {spaces.map((s) => (
            <li key={s.id} className="row justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <SpaceIndicator space={s} />
                <span className="truncate text-sm">{s.name}</span>
                <span className="faint text-2xs">
                  you are {isInviteRole(s.role) ? ROLE_LABEL[s.role].toLowerCase() : s.role}
                </span>
              </div>
              <Link
                href={`/spaces/${s.id}`}
                className="hairline inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs"
              >
                <Icon name="users" size={11} className="muted" />
                People and invites
              </Link>
            </li>
          ))}
        </ul>
        {spaces.length === 0 && (
          <p className="muted text-xs">
            You are not in any space yet. Make one above, or ask somebody who has
            one to send you an invitation link.
          </p>
        )}
      </section>

      <section className="px-5 pb-6">
        <h2 className="text-sm font-semibold">What each role can do</h2>
        <dl className="mt-2 max-w-2xl text-xs">
          {(['admin', 'member', 'viewer', 'free_busy'] as const).map((role) => (
            <div key={role} className="row items-start">
              <dt className="w-32 shrink-0 font-medium">{ROLE_LABEL[role]}</dt>
              <dd className="muted">{ROLE_MEANING[role]}</dd>
            </div>
          ))}
        </dl>
        <p className="faint mt-2 max-w-2xl text-2xs">
          A space’s <strong>owner</strong> is whoever created it. That is not a
          role an invitation can offer: it is a different fact from membership,
          and handing a household over by emailing somebody a link is not an
          operation this screen has.
        </p>
      </section>
    </div>
  );
}
