import Link from 'next/link';
import { Icon } from './Icon';
import { SpaceIndicator } from './SpaceIndicator';
import { SMART_LISTS, type SmartListKey } from '@/lib/queries/tasks';
import type { SpaceSummary } from '@/lib/queries/spaces';
import type { SessionUser } from '@/lib/auth';
import { usesDevAuth } from '@/lib/auth/session';
import { UserSwitcher } from './UserSwitcher';
import { AccountPanel } from './AccountPanel';

const LIST_ORDER: SmartListKey[] = [
  'today', 'overdue', 'upcoming', 'inbox', 'waiting', 'someday', 'all', 'done',
];

export function Sidebar({
  user,
  users,
  spaces,
  counts,
}: {
  user: SessionUser;
  users: SessionUser[];
  spaces: SpaceSummary[];
  counts: Record<SmartListKey, number>;
}) {
  return (
    <nav
      className="hairline flex w-60 shrink-0 flex-col gap-5 border-r px-3 py-4"
      style={{ background: 'var(--bg-sunken)' }}
      aria-label="Primary"
    >
      <div className="px-2">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Orbit
        </Link>
      </div>

      <div className="flex flex-col gap-0.5">
        <NavLink href="/" icon="check" label="Today" />
        <NavLink href="/capture" icon="plus" label="Capture" />
        <NavLink href="/search" icon="search" label="Search" />
        <NavLink href="/calendar/week" icon="calendar" label="Calendar" />
        <NavLink href="/people" icon="users" label="People" />
        <NavLink href="/places" icon="map_pin" label="Places" />
        <NavLink href="/travel" icon="route" label="Travel" />
        <NavLink href="/notes" icon="note" label="Notes" />
        <NavLink href="/rules" icon="route" label="Rules" />
        <NavLink href="/ai" icon="sparkle" label="AI" />
        <NavLink href="/sync" icon="undo" label="Sync" />
      </div>

      <Section title="Lists">
        {LIST_ORDER.map((key) => (
          <NavLink
            key={key}
            href={`/tasks/${key}`}
            icon={SMART_LISTS[key].icon}
            label={SMART_LISTS[key].label}
            count={counts[key]}
          />
        ))}
      </Section>

      <Section title="Spaces">
        <NavLink href="/spaces" icon="users" label="People and invites" />
        {spaces.map((s) => (
          <Link
            key={s.id}
            href={`/tasks/all?space=${s.id}`}
            className="row-hover flex items-center gap-2 rounded px-2 py-1"
          >
            <SpaceIndicator space={s} />
            {!s.canRead && (
              <span className="faint inline-flex items-center gap-1 text-2xs">
                <Icon name="eye_off" size={10} />
                free/busy
              </span>
            )}
          </Link>
        ))}
      </Section>

      {/* The switcher is impersonation by design: any seeded profile can be
          assumed in one click. It is therefore rendered only when the dev
          provider is live, and `switchUser` refuses on the same condition — the
          button being absent is a courtesy, the refusal is the boundary. */}
      <div className="mt-auto">
        {usesDevAuth() && users.length > 0 ? (
          <UserSwitcher current={user} users={users} />
        ) : (
          <AccountPanel user={user} />
        )}
      </div>
    </nav>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="faint px-2 pb-1 text-2xs font-semibold uppercase tracking-wider">
        {title}
      </h2>
      {children}
    </div>
  );
}

function NavLink({
  href,
  icon,
  label,
  count,
}: {
  href: string;
  icon: string;
  label: string;
  count?: number;
}) {
  return (
    <Link
      href={href as never}
      className="row-hover flex items-center gap-2 rounded px-2 py-1 text-sm"
    >
      <Icon name={icon} size={13} className="muted" />
      <span className="flex-1">{label}</span>
      {count != null && count > 0 && <span className="faint text-2xs">{count}</span>}
    </Link>
  );
}
