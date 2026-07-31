'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './Icon';
import { SpaceIndicator } from './SpaceIndicator';
import { UserSwitcher } from './UserSwitcher';
import { SMART_LISTS, type SmartListKey } from '@/lib/smartlists';
import type { SpaceSummary } from '@/lib/queries/spaces';
import type { SessionUser } from '@/lib/auth';

const LIST_ORDER: SmartListKey[] = [
  'today', 'overdue', 'upcoming', 'inbox', 'waiting', 'someday', 'all', 'done',
];

/**
 * Three destinations and a way to everything else.
 *
 * Now, Calendar and People are the three questions the app exists to answer —
 * what needs doing, when is it, who is where. Three is few enough that a top
 * row works, which hands the sidebar's 240px back to the content that needed
 * it. The other surfaces are all still one click away, under More; nothing was
 * removed, it was ranked.
 *
 * More is a <details>, so it opens on click or Enter and never on hover. There
 * is no hover-only information anywhere in Orbit — touch exists — and a
 * disclosure the browser already knows how to operate beats a popup we would
 * have to teach about Escape, focus and the outside click.
 */
export function TopNav({
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
  const pathname = usePathname();

  return (
    <nav
      className="hairline sticky top-0 z-30 border-b"
      style={{ background: 'var(--bg-sunken)' }}
      aria-label="Primary"
    >
      <div className="mx-auto flex w-full max-w-[76rem] flex-wrap items-center gap-x-1 gap-y-1 px-3 py-1.5">
        <Link href="/" className="mr-2 shrink-0 text-lg font-semibold tracking-tight">
          Orbit
        </Link>

        <Tab href="/" icon="check" label="Now" active={pathname === '/'} />
        <Tab
          href="/calendar"
          icon="calendar"
          label="Calendar"
          active={pathname.startsWith('/calendar')}
        />
        <Tab href="/people" icon="users" label="People" active={pathname.startsWith('/people')} />

        {/*
          Remounting on navigation is what closes the panel after a click — a
          state effect for the same job would have to know about every way a
          route can change.
        */}
        <details key={pathname} className="relative ml-auto shrink-0">
          <summary
            className="row-hover flex cursor-pointer list-none items-center gap-1.5 rounded px-2 py-1 text-sm"
            aria-label="More destinations"
          >
            <Icon name="plus" size={13} className="muted" />
            More
          </summary>

          <div
            className="surface absolute right-0 z-40 mt-1 flex max-h-[80vh] w-64 flex-col gap-3 overflow-y-auto p-2.5"
          >
            <Group label="Go to">
              <Item href="/capture" icon="plus" label="Capture" />
              <Item href="/search" icon="search" label="Search" />
              {/* The calendar is the week; these are the other two grains. */}
              <Item href="/calendar/day" icon="calendar" label="Calendar — day" />
              <Item href="/calendar/month" icon="calendar" label="Calendar — month" />
              <Item href="/places" icon="map_pin" label="Places" />
              <Item href="/travel" icon="route" label="Travel" />
              <Item href="/notes" icon="note" label="Notes" />
              <Item href="/rules" icon="route" label="Rules" />
              <Item href="/ai" icon="sparkle" label="AI" />
              <Item href="/sync" icon="undo" label="Sync" />
            </Group>

            <Group label="Lists">
              {LIST_ORDER.map((key) => (
                <Item
                  key={key}
                  href={`/tasks/${key}`}
                  icon={SMART_LISTS[key].icon}
                  label={SMART_LISTS[key].label}
                  count={counts[key]}
                />
              ))}
            </Group>

            <Group label="Spaces">
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
            </Group>

            <UserSwitcher current={user} users={users} />
          </div>
        </details>
      </div>
    </nav>
  );
}

function Tab({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href as never}
      aria-current={active ? 'page' : undefined}
      className="row-hover flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1 text-sm"
      style={
        active
          ? // Same idea as the range switch: the selected tab is a raised
            // surface with a stronger edge and weight 600, never a hue.
            {
              background: 'var(--bg-raised)',
              border: '1px solid var(--line-strong)',
              fontWeight: 600,
            }
          : { border: '1px solid transparent' }
      }
    >
      <Icon name={icon} size={13} className="muted" />
      {label}
    </Link>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="section-label px-2 pb-1">{label}</h2>
      {children}
    </div>
  );
}

function Item({
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
