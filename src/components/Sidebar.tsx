import { SidebarNav } from './SidebarNav';
import { MobileNav } from './MobileNav';
import type { SmartListKey } from '@/lib/smartlists';
import type { SpaceSummary } from '@/lib/queries/spaces';
import type { SessionUser } from '@/lib/auth';
import { usesDevAuth } from '@/lib/auth/session';
import { UserSwitcher } from './UserSwitcher';
import { AccountPanel } from './AccountPanel';

/**
 * Navigation, in its two shapes.
 *
 * `SidebarNav` holds the links and knows nothing about where it is rendered;
 * this file decides that a wide screen gets a fixed rail and a narrow one gets
 * a bottom bar plus a drawer holding the same rail.
 *
 * The bottom slot stays here because the decision behind it is a server
 * decision: the switcher is impersonation by design, so it is rendered only
 * when the dev provider is live, and `switchUser` refuses on the same
 * condition — the button being absent is a courtesy, the refusal is the
 * boundary.
 */
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
  const footer =
    usesDevAuth() && users.length > 0 ? (
      <UserSwitcher current={user} users={users} />
    ) : (
      <AccountPanel user={user} />
    );

  return (
    <>
      <nav
        className="hairline hidden w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r px-3 py-4 md:sticky md:top-0 md:flex md:h-screen"
        style={{ background: 'var(--bg-sunken)' }}
        aria-label="Primary"
      >
        <SidebarNav spaces={spaces} counts={counts} footer={footer} />
      </nav>

      <MobileNav>
        <SidebarNav spaces={spaces} counts={counts} footer={footer} />
      </MobileNav>
    </>
  );
}
