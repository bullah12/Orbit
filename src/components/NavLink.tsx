'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Icon } from './Icon';

/**
 * A navigation link that knows whether you are standing on it.
 *
 * Until now every link in the sidebar rendered identically, so on `/` the word
 * "Today" looked exactly like "Travel" — there was no way to tell where you
 * were, by eye or with a screen reader. `aria-current="page"` is the fix for
 * the second, and it doubles as the styling hook for the first, which is the
 * same arrangement `.seg` already uses in globals.css.
 *
 * Selection is carried by weight and a raised surface, never by hue: the nav
 * sits directly above ten coloured space chips and must not compete with them.
 */

/** Exact for `/`, prefix for everything else, and a space link matches on its
 *  `space` parameter rather than on the list it happens to point at. */
export function isActive(href: string, pathname: string, spaceParam: string | null) {
  const [path, query] = href.split('?');
  const wanted = new URLSearchParams(query ?? '').get('space');

  if (wanted) return spaceParam === wanted;
  // A smart list carrying no space of its own is not the active one while a
  // space is being viewed through it.
  if (path !== '/' && pathname.startsWith('/tasks/') && spaceParam) return false;

  if (path === '/') return pathname === '/';
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function NavLink({
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
  const pathname = usePathname();
  const active = isActive(href, pathname, useSearchParams().get('space'));

  return (
    <Link
      href={href as never}
      aria-current={active ? 'page' : undefined}
      className="row-hover nav-link flex items-center gap-2 rounded px-2 py-1 text-sm"
    >
      <Icon name={icon} size={13} className={active ? undefined : 'muted'} />
      <span className="flex-1">{label}</span>
      {count != null && count > 0 && <span className="faint text-2xs tabular-nums">{count}</span>}
    </Link>
  );
}
