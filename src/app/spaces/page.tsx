import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listSpaces } from '@/lib/queries/spaces';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { ROLE_LABEL, ROLE_MEANING, isInviteRole } from '@/lib/invites';

export const dynamic = 'force-dynamic';

/**
 * Who is in which space.
 *
 * A space is the unit of sharing in Orbit — `spaces.id` is the `space_id` on
 * every space-scoped table — so this is the only screen where "who can see my
 * things" is a question with an answer on it.
 */
export default async function SpacesPage() {
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
            You are not in any space yet. Somebody with a space can send you an
            invitation link.
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
