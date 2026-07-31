import { switchUser } from '@/app/actions';
import type { SessionUser } from '@/lib/auth';
import { Icon } from './Icon';

/**
 * Dev-only identity switch. It exists because the whole point of Orbit's
 * sharing model is what the *other* person sees, and that is impossible to
 * check without being able to become them in one click.
 */
export function UserSwitcher({
  current,
  users,
}: {
  current: SessionUser;
  users: SessionUser[];
}) {
  return (
    <form action={switchUser} className="hairline border-t px-2 pt-3">
      <div className="faint mb-1.5 flex items-center gap-1 text-2xs font-semibold uppercase tracking-wider">
        <Icon name="user" size={10} />
        Viewing as
      </div>
      <div className="flex flex-col gap-0.5">
        {users.map((u) => (
          <button
            key={u.id}
            name="userId"
            value={u.id}
            type="submit"
            className="row-hover flex items-center gap-2 rounded px-1.5 py-1 text-left text-xs"
            style={
              u.id === current.id
                ? { background: 'var(--bg-hover)', fontWeight: 600 }
                : undefined
            }
          >
            <span
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
              style={{
                background: u.id === current.id ? 'var(--accent)' : 'var(--line-strong)',
              }}
            />
            {u.displayName}
          </button>
        ))}
      </div>
    </form>
  );
}
