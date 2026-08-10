'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Icon } from './Icon';
import { isActive } from './NavLink';

/**
 * Navigation on a narrow screen: four tabs, and nothing else.
 *
 * The rail is 240px, which is 62% of a 390px phone — so below `md` it is not
 * shown at all and this takes over. Along the bottom rather than the top
 * because that is where a thumb is. The bar sits above the home indicator via
 * `env(safe-area-inset-bottom)`, and `<main>` carries matching padding (the
 * `--tabbar` token) so the last row of a list is never parked underneath it.
 *
 * It used to be six columns and a drawer. Both are gone, and the reasons are
 * worth keeping:
 *
 * - **Six was too many.** At 390px a six-column bar gives each tab 65px, which
 *   is a 22px icon with a label that has to be abbreviated to fit under it.
 *   Four is the number where a tab can be a touch target and a word at once.
 * - **The drawer is now a page** (`/more`). A drawer covering the page needs a
 *   backdrop, an Escape handler and a focus trap, all so that somebody can
 *   reach Notes. A route needs none of them, is linkable, and the back button
 *   already means what it says. Removing a focus trap is a win.
 * - **Capture left the bar** and is the FAB (`CaptureFab`), rendered once from
 *   the root layout so it is over every tab rather than being one of them.
 * - **Search left the bar** and is a header button on the pages that bear a
 *   list, where it can carry that page's context into the query.
 */

/**
 * The four. Not `PRIMARY` — the rail's list and the bar's list stopped being
 * the same list when Capture and Search left, and pretending otherwise would
 * mean a filter here that quietly re-breaks the moment the rail gains an entry.
 * `/more` is the tab that reaches everything not named here.
 */
const TABS = [
  { href: '/', icon: 'check', label: 'Home' },
  { href: '/calendar/week', icon: 'calendar', label: 'Calendar' },
  { href: '/people', icon: 'users', label: 'People' },
  { href: '/more', icon: 'dots', label: 'More' },
] as const;

export function MobileNav() {
  const pathname = usePathname();
  const spaceParam = useSearchParams().get('space');

  return (
    <nav
      aria-label="Primary"
      className="hairline fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t md:hidden"
      style={{
        background: 'var(--bg-raised)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {TABS.map((t) => {
        const active = isActive(t.href, pathname, spaceParam);
        return (
          <Link
            key={t.href}
            href={t.href as never}
            aria-current={active ? 'page' : undefined}
            className="tab flex flex-col items-center justify-center gap-1"
          >
            <Icon name={t.icon} size={22} className={active ? undefined : 'muted'} />
            <span className={active ? 'text-xs font-semibold' : 'muted text-xs'}>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
