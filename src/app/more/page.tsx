import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { usesDevAuth } from '@/lib/auth/session';
import { listSpaces, spaceMemberCounts, type SpaceSummary } from '@/lib/queries/spaces';
import { smartListCounts } from '@/lib/queries/tasks';
import { moreCounts } from '@/lib/queries/more';
// From `@/lib/nav`, not from `SidebarNav` — that module is `'use client'`,
// and a Server Component importing an array from one gets a client reference
// rather than the array. See the note at the top of `src/lib/nav.ts`.
import { SECONDARY, ADMIN } from '@/lib/nav';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { initials } from '@/components/people/PersonAvatar';
import { Icon } from '@/components/Icon';
import { plural } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Everything the four tabs do not reach.
 *
 * This replaces the drawer. A drawer covering the page needs a backdrop, an
 * Escape handler and a focus trap, all so somebody can get to Notes — and it
 * has no URL, so you cannot link to it, the back button does not close it, and
 * the whole of the rail has to be rendered a second time to fill it. A page
 * needs none of that. The focus trap that came out is the part worth saying
 * out loud: removing one is always a win.
 *
 * It is not the rail rearranged into a column. The rail enumerates the nine
 * smart lists because it has 240px of height to spend on them; here they live
 * behind one **Tasks** row, because the phone reaches them through the
 * segmented filter on `/tasks/[list]` and listing them twice would make the
 * page scroll for no new destination. That regrouping is the reason `/more`
 * reads the `SECONDARY`/`ADMIN` arrays rather than rendering `SidebarNav`.
 *
 * One scroll, no nested navigation: every row here goes to the thing it names.
 *
 * Account is pinned to the bottom rather than sitting at the end of the
 * scroll, mirroring the `mt-auto` footer slot the rail already uses. Who you
 * are signed in as is the answer to a question you ask *at* the settings
 * screen, not something you should have to scroll past four groups to find.
 */
export default async function MorePage() {
  const user = await requireUser();
  const [spaces, counts, members, more] = await Promise.all([
    listSpaces(user.id),
    smartListCounts(user.id),
    spaceMemberCounts(user.id),
    moreCounts(user.id),
  ]);

  // The count each row is allowed to show. A row with nothing to say says
  // nothing rather than "0" — zero is a number about an empty page, and this
  // list is for deciding which page to open.
  const detail = (n: number, one: string, many = `${one}s`) =>
    n > 0 ? `${n} ${n === 1 ? one : many}` : undefined;

  // Automation is named; System is the remainder, so an entry added to ADMIN
  // later appears here rather than silently going missing from the phone.
  const AUTOMATION = new Set<string>(['/rules', '/ai']);
  const automation = ADMIN.filter((l) => AUTOMATION.has(l.href));
  const system = ADMIN.filter((l) => !AUTOMATION.has(l.href));

  return (
    <div className="measure flex flex-col" style={{ minHeight: 'calc(100svh - var(--tabbar))' }}>
      <header className="px-5 pb-2 pt-1">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] md:text-lg md:tracking-normal">
          More
        </h1>
      </header>

      <Group title="Your stuff">
        {/* One row, not nine. The nine live on the task page's own filter. */}
        <Row
          href="/tasks/all"
          icon="check"
          label="Tasks"
          detail={detail(counts.all, 'open task')}
        />
        {SECONDARY.map((l) => (
          <Row
            key={l.href}
            href={l.href}
            icon={l.icon}
            label={l.label}
            detail={
              l.href === '/places' ? detail(more.places, 'place')
              : l.href === '/notes' ? detail(more.notes, 'note')
              : undefined
            }
          />
        ))}
      </Group>

      <Group title="Spaces and invites">
        <Row href="/spaces" icon="users" label="People and invites" />
        {spaces.map((s) => (
          <SpaceRow key={s.id} space={s} members={members[s.id] ?? 0} />
        ))}
      </Group>

      <Group title="Automation">
        {automation.map((l) => (
          <Row
            key={l.href}
            href={l.href}
            icon={l.icon}
            label={l.label}
            detail={
              l.href === '/rules' ? (more.rulesOn > 0 ? `${more.rulesOn} on` : undefined)
              : l.href === '/ai' ? detail(more.consents, 'consent')
              : undefined
            }
          />
        ))}
      </Group>

      <Group title="System">
        {system.map((l) => (
          <Row key={l.href} href={l.href} icon={l.icon} label={l.label} />
        ))}
      </Group>

      <div className="mt-auto">
        <Account
          displayName={user.displayName}
          email={user.email}
          canSignOut={!usesDevAuth()}
        />
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`more-${slug(title)}`}>
      <h2
        id={`more-${slug(title)}`}
        className="hairline section-label border-y px-5 py-1.5"
        style={{ background: 'var(--bg-sunken)' }}
      >
        {title}
      </h2>
      <ul>{children}</ul>
    </section>
  );
}

function Row({
  href,
  icon,
  label,
  detail,
}: {
  href: string;
  icon: string;
  label: string;
  /** A count or a status. Optional — most rows are just a destination. */
  detail?: string;
}) {
  return (
    <li>
      <Link href={href as never} className="set-row row-hover">
        <Icon name={icon} size={19} className="muted shrink-0" />
        <span className="min-w-0 flex-1 truncate text-lg">{label}</span>
        {detail && <span className="faint shrink-0 text-sm tabular-nums">{detail}</span>}
        <Icon name="chevron" size={17} className="faint shrink-0" />
      </Link>
    </li>
  );
}

/**
 * A space carries its own indicator rather than a generic icon — colour, icon
 * and label together, as everywhere else. The status says the one thing the
 * chip cannot: `free/busy only` is not a smaller space, it is a different
 * relationship to it, and somebody looking at this list should not have to
 * open it to find out.
 */
function SpaceRow({ space, members }: { space: SpaceSummary; members: number }) {
  const status = !space.canRead
    ? 'free/busy only'
    : members > 0
      ? plural(members, 'member')
      : 'just you';

  return (
    <li>
      <Link href={`/tasks/all?space=${space.id}` as never} className="set-row row-hover">
        {/* The chip is the name, the colour and the icon in one object — the
            same one the rest of the app uses. Putting the name beside it as
            plain text would be the word twice, so the space the label would
            have taken goes to the status instead. */}
        <SpaceIndicator space={space} />
        <span className="muted min-w-0 flex-1 truncate text-lg">{status}</span>
        <Icon name="chevron" size={17} className="faint shrink-0" />
      </Link>
    </li>
  );
}

function Account({
  displayName,
  email,
  canSignOut,
}: {
  displayName: string;
  email: string;
  canSignOut: boolean;
}) {
  return (
    <section
      aria-labelledby="more-account"
      className="hairline border-t"
      style={{ background: 'var(--bg-raised)' }}
    >
      <h2 id="more-account" className="sr-only">
        Account
      </h2>
      <div className="flex min-h-[60px] items-center gap-3.5 px-5 py-2">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
          style={{ background: 'var(--bg-sunken)', color: 'var(--text-muted)' }}
        >
          {initials(displayName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-lg">{displayName}</span>
          <span className="faint block truncate text-sm" title={email}>
            {email}
          </span>
        </span>
        {canSignOut ? (
          <Link
            href="/auth/signout"
            className="hairline btn shrink-0 rounded-md border px-3 py-2 text-sm"
          >
            Sign out
          </Link>
        ) : (
          // Under the dev provider there is no session to end, so the row goes
          // where the account settings are rather than offering a control that
          // would refuse. `UserSwitcher` in the rail is the impersonation seam
          // and it is deliberately not repeated here.
          <Link
            href="/settings"
            aria-label="Account settings"
            className="row-hover flex h-9 w-9 shrink-0 items-center justify-center rounded"
          >
            <Icon name="chevron" size={17} className="faint" />
          </Link>
        )}
      </div>
    </section>
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z]+/g, '-');
}
