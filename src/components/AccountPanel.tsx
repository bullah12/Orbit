import Link from 'next/link';
import { Icon } from './Icon';
import type { SessionUser } from '@/lib/auth';

/**
 * Who you are, when who you are is a real account.
 *
 * This takes the switcher's place in the sidebar whenever `AUTH_PROVIDER` is
 * not `dev`. It offers one thing the switcher never could — signing out — and
 * cannot offer the one thing the switcher exists for, which is the point.
 */
export function AccountPanel({ user }: { user: SessionUser }) {
  return (
    <div className="hairline border-t px-2 pt-3">
      <div className="faint mb-1.5 flex items-center gap-1 text-2xs font-semibold uppercase tracking-wider">
        <Icon name="user" size={10} />
        Signed in
      </div>
      <div className="px-1.5 text-xs font-medium">{user.displayName}</div>
      <div className="faint truncate px-1.5 text-2xs" title={user.email}>
        {user.email}
      </div>
      <Link
        href="/auth/signout"
        className="row-hover mt-1 flex items-center gap-2 rounded px-1.5 py-1 text-xs"
      >
        <Icon name="arrow_right" size={11} className="muted" />
        Sign out
      </Link>
    </div>
  );
}
