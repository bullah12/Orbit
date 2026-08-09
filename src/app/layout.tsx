import type { Metadata, Viewport } from 'next';
import './globals.css';
import { devAuthRefusal, getCurrentUser, listSelectableUsers, usesDevAuth } from '@/lib/auth';
import { listSpaces } from '@/lib/queries/spaces';
import { smartListCounts } from '@/lib/queries/tasks';
import { Sidebar } from '@/components/Sidebar';
import { Shortcuts } from '@/components/Shortcuts';
import { THEME_COLOUR, themeAttribute } from '@/lib/prefs';
import { readTheme } from '@/lib/prefs/cookies';
import { RegisterServiceWorker } from '@/components/ServiceWorker';

export const metadata: Metadata = {
  title: 'Orbit',
  description: 'Tasks, notes, people and calendar, in spaces you control.',
  appleWebApp: { capable: true, title: 'Orbit', statusBarStyle: 'default' },
};

/**
 * Without this a phone assumes a ~980px layout viewport and scales the whole
 * page down, which is why Orbit was unreadable on one. `maximum-scale` is
 * deliberately not set: pinching to zoom is somebody's accessibility, not a
 * layout bug to be suppressed.
 *
 * The two theme colours match `--bg` in each scheme so the browser chrome does
 * not sit as a bright band above a dark app.
 *
 * `generateViewport` rather than a constant, because the theme is now a choice.
 * A person who has pinned dark and whose phone is in light mode would otherwise
 * get a pale status bar above a dark app — the media-query form answers the OS,
 * and once there is an override the OS is no longer the authority. Pinned, one
 * colour is emitted and no media query; on "system" both are, exactly as
 * before. The page is `force-dynamic` already, so reading a cookie here costs
 * nothing that was not already being paid.
 */
export async function generateViewport(): Promise<Viewport> {
  const theme = await readTheme();
  const base = { width: 'device-width', initialScale: 1, viewportFit: 'cover' } as const;

  if (theme === 'light' || theme === 'dark') {
    return { ...base, themeColor: THEME_COLOUR[theme] };
  }
  return {
    ...base,
    themeColor: [
      { media: '(prefers-color-scheme: light)', color: THEME_COLOUR.light },
      { media: '(prefers-color-scheme: dark)', color: THEME_COLOUR.dark },
    ],
  };
}

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let body: React.ReactNode;

  // Read before anything else, and rendered onto <html> below. This is the
  // whole of "no flash on load": the attribute is in the markup the browser
  // first parses, so the correct palette is resolved at first paint. There is
  // deliberately no effect, no inline script and no `localStorage` read — each
  // of those runs *after* something has already been painted, which is the
  // flash. Reading it outside the try/catch keeps the database-down page on the
  // chosen theme too.
  const theme = themeAttribute(await readTheme());

  // Checked before anything else so it gets its own page rather than being
  // swallowed by the catch below, which says "Orbit can't reach its database" —
  // an actively misleading sentence for a deployment that is refusing to serve
  // impersonation to the public internet. `authProvider()` throws on this too,
  // so every other entry point fails closed; this is the one that explains it.
  const refusal = devAuthRefusal();
  if (refusal) {
    return (
      <html lang="en-GB" data-theme={theme}>
        <body>
          <div className="mx-auto max-w-xl p-10">
            <h1 className="mb-2 text-lg font-semibold">Orbit will not start like this</h1>
            <p className="muted mb-4 text-sm">{refusal}</p>
            <p className="faint text-xs">
              This is deliberate and it is not a bug. See <code>docs/deploy.md</code>,
              and “Known bugs” 22 in <code>docs/STATUS.md</code>.
            </p>
          </div>
        </body>
      </html>
    );
  }

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
          {/* The bottom tab bar is fixed, so the last row of a list would sit
              underneath it. `--tabbar` is that height plus the home indicator,
              and it is zero from `md` up where the bar is not rendered. */}
          <main id="main" tabIndex={-1} className="min-w-0 flex-1 pb-[var(--tabbar)]">
            {children}
          </main>
          <Shortcuts />
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
    <html lang="en-GB" data-theme={theme}>
      <body>
        {body}
        {/* Registers after load, and does nothing at all where `serviceWorker`
            is absent. Outside `body` above so it is present on the sign-in page
            and the database-down page too — the offline shell is most useful
            to somebody whose connection is already unreliable. */}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
