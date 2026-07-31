import type { Metadata } from 'next';
import './globals.css';
import { getCurrentUser, listSelectableUsers, usesDevAuth } from '@/lib/auth';
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
    // getCurrentUser rather than requireUser: with a real provider, "nobody is
    // signed in" is an ordinary state and the sign-in page is a page like any
    // other. It renders with no sidebar — there are no spaces to list and
    // nobody to switch to — and every other page redirects here itself, via
    // requireUser().
    const user = await getCurrentUser();

    if (!user) {
      if (usesDevAuth()) {
        throw new Error(
          'No profile found. Run ./scripts/db-reset.sh to create and seed the database.',
        );
      }
      body = (
        <main id="main" tabIndex={-1}>
          {children}
        </main>
      );
    } else {
      const [spaces, counts, users] = await Promise.all([
        listSpaces(user.id),
        smartListCounts(user.id),
        listSelectableUsers(),
      ]);
      body = (
        <div className="flex min-h-screen">
          <a href="#main" className="skip-link">
            Skip to content
          </a>
          <Sidebar user={user} users={users} spaces={spaces} counts={counts} />
          <main id="main" tabIndex={-1} className="min-w-0 flex-1">
            {children}
          </main>
        </div>
      );
    }
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
