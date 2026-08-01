'use client';

import Link from 'next/link';
import { Icon } from './Icon';
import { NavLink, isActive } from './NavLink';
import { SpaceIndicator } from './SpaceIndicator';
import { SMART_LISTS, type SmartListKey } from '@/lib/smartlists';
import type { SpaceSummary } from '@/lib/queries/spaces';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * The navigation itself, with no opinion about where it is rendered.
 *
 * One copy, two homes: the fixed rail on a wide screen and the drawer on a
 * narrow one. Writing it twice is how the two drift apart — the same reason
 * `DayColumns` renders both the day and the week.
 *
 * `footer` is a slot rather than a child component because the thing that goes
 * in it (the dev switcher, or the account panel) is a Server Component and
 * decided on the server: `usesDevAuth()` is the boundary and it is not this
 * component's business.
 */

const LIST_ORDER: SmartListKey[] = [
  'mine', 'today', 'overdue', 'upcoming', 'inbox', 'waiting', 'someday', 'all', 'done',
];

/** The surfaces you reach for. Rules, Sync and AI are administration and live
 *  below the fold in `MORE`, rather than beside Today at the same weight. */
export const PRIMARY = [
  { href: '/', icon: 'check', label: 'Today' },
  { href: '/calendar/week', icon: 'calendar', label: 'Calendar' },
  { href: '/capture', icon: 'plus', label: 'Capture' },
  { href: '/search', icon: 'search', label: 'Search' },
  { href: '/people', icon: 'users', label: 'People' },
] as const;

const SECONDARY = [
  { href: '/places', icon: 'map_pin', label: 'Places' },
  { href: '/travel', icon: 'route', label: 'Travel' },
  { href: '/notes', icon: 'note', label: 'Notes' },
] as const;

const ADMIN = [
  { href: '/rules', icon: 'route', label: 'Rules' },
  { href: '/ai', icon: 'sparkle', label: 'AI' },
  { href: '/sync', icon: 'undo', label: 'Sync' },
] as const;

export function SidebarNav({
  spaces,
  counts,
  footer,
  onNavigate,
}: {
  spaces: SpaceSummary[];
  counts: Record<SmartListKey, number>;
  footer?: React.ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="px-2">
        <Link href="/" onClick={onNavigate} className="text-lg font-semibold tracking-tight">
          Orbit
        </Link>
      </div>

      <div className="flex flex-col gap-0.5">
        {[...PRIMARY, ...SECONDARY].map((l) => (
          <NavLink key={l.href} {...l} onNavigate={onNavigate} />
        ))}
      </div>

      <Section title="Lists">
        {LIST_ORDER.map((key) => (
          <NavLink
            key={key}
            href={`/tasks/${key}`}
            icon={SMART_LISTS[key].icon}
            label={SMART_LISTS[key].label}
            count={counts[key]}
            onNavigate={onNavigate}
          />
        ))}
      </Section>

      <Section title="Spaces">
        <NavLink href="/spaces" icon="users" label="People and invites" onNavigate={onNavigate} />
        {spaces.map((s) => (
          <SpaceLink key={s.id} space={s} onNavigate={onNavigate} />
        ))}
      </Section>

      <Section title="More">
        {ADMIN.map((l) => (
          <NavLink key={l.href} {...l} onNavigate={onNavigate} />
        ))}
      </Section>

      {footer && <div className="mt-auto pt-2">{footer}</div>}
    </>
  );
}

function SpaceLink({ space, onNavigate }: { space: SpaceSummary; onNavigate?: () => void }) {
  const href = `/tasks/all?space=${space.id}`;
  const active = isActive(href, usePathname(), useSearchParams().get('space'));

  return (
    <Link
      href={href as never}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className="row-hover nav-link flex items-center gap-2 rounded px-2 py-1"
    >
      <SpaceIndicator space={space} />
      {!space.canRead && (
        <span className="faint inline-flex items-center gap-1 text-2xs">
          <Icon name="eye_off" size={10} />
          free/busy
        </span>
      )}
    </Link>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="faint px-2 pb-1 text-2xs font-semibold uppercase tracking-wider">{title}</h2>
      {children}
    </div>
  );
}
