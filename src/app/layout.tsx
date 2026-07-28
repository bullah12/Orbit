import type { Metadata } from 'next';
import './globals.css';
import { requireUser, listSelectableUsers } from '@/lib/auth';
import { listSpaces } from '@/lib/queries/spaces';
import { smartListCounts } from '@/lib/queries/tasks';
import { Sidebar } from '@/components/Sidebar';

export const metadata: Metadata = {
  title: 'Orbit',
  description: 'Tasks, notes, people and calendar, in spaces you control.',
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let body: React.ReactNode;

  try {
    const user = await requireUser();
    const [spaces, counts, users] = await Promise.all([
      listSpaces(user.id),
      smartListCounts(user.id),
      listSelectableUsers(),
    ]);
    body = (
      <div className="flex min-h-screen">
        <Sidebar user={user} users={users} spaces={spaces} counts={counts} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    );
  } catch (err) {
    // A missing database is the single most likely first-run failure. Say so
    // plainly with the command that fixes it, rather than a stack trace.
    body = (
      <div className="mx-auto max-w-xl p-10">
        <h1 className="mb-2 text-lg font-semibold">Orbit can’t reach its database</h1>
        <p className="muted mb-4">
          Run the reset script, then reload. It creates the schema and seeds it.
        </p>
        <pre className="surface overflow-x-auto rounded p-3 text-xs">./scripts/db-reset.sh</pre>
        <p className="faint mt-4 text-xs">{err instanceof Error ? err.message : String(err)}</p>
      </div>
    );
  }

  return (
    <html lang="en-GB">
      <body>{body}</body>
    </html>
  );
}
