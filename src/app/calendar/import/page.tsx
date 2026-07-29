import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listSpaces } from '@/lib/queries/spaces';
import { listCalendarsBySpace } from '@/lib/queries/events';
import { connectCalendar, importIcs, pushCalendarEdits, syncCalendar } from '@/app/actions';
import { calendarProvider, icsProvider, providerSummary } from '@/lib/integrations';
import { listConnectedCalendars } from '@/lib/sync/calendar';
import { FakeIcsProvider } from '@/lib/integrations/ics/fake';
import { Icon } from '@/components/Icon';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { plural } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * ICS import.
 *
 * The provider is chosen by ICS_PROVIDER and defaults to the fixture-backed
 * fake, so this page works end to end with no network and no credential. With
 * ICS_PROVIDER=http it takes a URL instead — that implementation is written
 * and has never been run here, and the page says so rather than implying the
 * two are equivalent.
 *
 * Only calendars the caller can *write* are offered, because the policy would
 * refuse the others and offering one would be offering a refusal.
 */
export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{
    imported?: string; updated?: string; rules?: string;
    added?: string; changed?: string; removed?: string; full?: string;
    pushed?: string; created?: string; locked?: string; failed?: string;
  }>;
}) {
  const user = await requireUser();
  const { imported, updated, rules, added, changed, removed, full, pushed, created, locked, failed } =
    await searchParams;

  const calProvider = calendarProvider();
  const [spaces, calendars, connected, remote] = await Promise.all([
    listSpaces(user.id),
    listCalendarsBySpace(user.id),
    listConnectedCalendars(user.id),
    // A provider that needs a credential throws here rather than at import, so
    // the page still renders and says what went wrong.
    calProvider.listCalendars().catch((err: unknown) => ({ error: String(err) }) as const),
  ]);
  const remoteCalendars = Array.isArray(remote) ? remote : [];
  const remoteError = Array.isArray(remote) ? null : remote.error;

  const provider = icsProvider();
  const fixtures = provider instanceof FakeIcsProvider ? provider.listFixtures() : [];
  const writableSpaces = spaces.filter((s) => s.canWrite);
  const summary = providerSummary();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="hairline border-b px-5 py-4">
        <h1 className="text-[15px] font-semibold">Import a calendar</h1>
        <p className="muted mt-0.5 text-[12px]">
          Events are matched on the feed’s own UID, so importing the same feed twice
          updates rather than duplicates.
        </p>
        <Link href="/calendar/week" className="faint mt-2 inline-block text-[12px]">
          ← Back to the calendar
        </Link>
      </header>

      {imported != null && (
        <div
          className="hairline border-b px-5 py-2 text-[13px]"
          role="status"
          aria-live="polite"
        >
          Imported {plural(Number(imported), 'new event')}, updated {updated},
          {' '}stored {plural(Number(rules ?? 0), 'recurrence rule')}.
        </div>
      )}

      {added != null && (
        <div
          className="hairline border-b px-5 py-2 text-[13px]"
          role="status"
          aria-live="polite"
        >
          {full === '1' ? 'Full pull' : 'Incremental pull'}: {plural(Number(added), 'new event')},
          {' '}{changed} changed, {removed} cancelled.
        </div>
      )}

      {pushed != null && (
        <div
          className="hairline border-b px-5 py-2 text-[13px]"
          role="status"
          aria-live="polite"
          id="push-result"
        >
          Pushed {plural(Number(pushed), 'event')} back ({created} created),
          {' '}{plural(Number(locked ?? 0), 'locked event')} skipped because there is no
          plaintext to send, {failed} refused.
        </div>
      )}

      <section className="hairline border-b px-5 py-4">
        <h2 className="faint mb-2 text-[10px] font-semibold uppercase tracking-wider">Source</h2>

        {provider.isFake ? (
          <p className="muted mb-3 text-[12px]">
            <Icon name="alert" size={11} className="mr-1 inline" />
            Using the fixture-backed provider (<code>ICS_PROVIDER=fake</code>). These feeds
            ship with Orbit and need no network. Set <code>ICS_PROVIDER=http</code> to import
            a real URL — that implementation is written but has never been run here.
          </p>
        ) : (
          <p className="muted mb-3 text-[12px]">
            <Icon name="alert" size={11} className="mr-1 inline" />
            Using <code>ICS_PROVIDER=http</code>. This implementation has never been executed
            in this environment; if it fails, that is the first thing to suspect.
          </p>
        )}

        {writableSpaces.length === 0 ? (
          <p className="faint text-[12px]">You cannot write to any space, so there is nowhere to import to.</p>
        ) : (
          <form action={importIcs} className="flex flex-col gap-3" aria-label="Import an ICS feed">
            <label className="flex max-w-md flex-col gap-1">
              <span className="faint text-[11px] font-medium">
                {provider.isFake ? 'Fixture' : 'Feed URL'}
              </span>
              {provider.isFake ? (
                <select name="ref" className="input" required defaultValue={fixtures[0] ?? ''}>
                  {fixtures.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              ) : (
                <input
                  name="ref"
                  className="input"
                  required
                  placeholder="https://example.org/calendar.ics"
                />
              )}
            </label>

            <label className="flex max-w-md flex-col gap-1">
              <span className="faint text-[11px] font-medium">Import into</span>
              <select name="calendarId" className="input" required>
                {writableSpaces.map((space) =>
                  (calendars[space.id] ?? [])
                    .filter((c) => c.isWritable)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {space.shortLabel} — {c.name}
                      </option>
                    )),
                )}
              </select>
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <span className="faint text-[11px]">Destination spaces:</span>
              {writableSpaces.map((s) => (
                <SpaceIndicator key={s.id} space={s} />
              ))}
            </div>

            <div>
              <button
                type="submit"
                className="rounded px-3 py-1.5 text-[12px] font-medium"
                style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
              >
                Import
              </button>
            </div>
          </form>
        )}
      </section>


      <section className="hairline border-b px-5 py-4">
        <h2 className="faint mb-2 text-[10px] font-semibold uppercase tracking-wider">
          Connect a calendar
        </h2>
        <p className="muted mb-3 text-[12px]">
          <Icon name="alert" size={11} className="mr-1 inline" />
          {calProvider.isFake
            ? 'Using the fixture-backed calendar provider (CALENDAR_PROVIDER=fake). Connecting one pulls its events in with no network and no credential. A second pull is incremental — it carries the sync token from the first and returns only what changed.'
            : 'Using CALENDAR_PROVIDER=google. That implementation is written against the published API and has never been executed in this environment.'}
        </p>

        {remoteError ? (
          <p className="muted text-[12px]" role="status">
            The provider could not list its calendars: <code>{remoteError}</code>
          </p>
        ) : writableSpaces.length === 0 ? (
          <p className="faint text-[12px]">You cannot write to any space, so there is nowhere to connect one.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {remoteCalendars.map((rc) => (
              <li key={rc.externalId} className="surface flex flex-wrap items-center gap-2 rounded p-2">
                <Icon name="calendar" size={12} className="muted" />
                <span className="text-[13px]">{rc.name}</span>
                <span className="faint text-[11px]">
                  {rc.writable ? 'read and write' : 'read only'}
                </span>
                <form action={connectCalendar} className="ml-auto flex items-center gap-2">
                  <input type="hidden" name="externalId" value={rc.externalId} />
                  <input type="hidden" name="name" value={rc.name} />
                  <input type="hidden" name="writable" value={String(rc.writable)} />
                  <label className="flex items-center gap-1">
                    <span className="sr-only">Space for {rc.name}</span>
                    <select name="spaceId" className="input" defaultValue={writableSpaces[0]!.id}>
                      {writableSpaces.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="submit"
                    className="hairline row-hover rounded border px-2 py-1 text-[12px]"
                  >
                    Connect and pull
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="hairline border-b px-5 py-4">
        <h2 className="faint mb-2 text-[10px] font-semibold uppercase tracking-wider">
          Calendars in your spaces
        </h2>
        <ul className="flex flex-col gap-1" id="connected-calendars">
          {connected.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 text-[12px]">
              <SpaceIndicator
                space={
                  spaces.find((s) => s.id === c.spaceId) ?? {
                    id: c.spaceId, name: c.spaceLabel, shortLabel: c.spaceLabel,
                    colour: 'slate', icon: 'calendar',
                  }
                }
              />
              <span className="text-[13px]">{c.name}</span>
              <span className="faint">{c.provider}</span>
              <span className="faint">{plural(c.eventCount, 'event')}</span>
              {c.lastStatus && (
                <span className="faint">
                  last pull {c.lastStatus}
                  {c.hasToken ? ', token held' : ''}
                </span>
              )}
              {/* Both directions, named. Until Phase 6 only 'pull' was ever
                  written, and a local edit set is_dirty and sat there. */}
              <span className="faint" data-dirty={c.dirtyCount}>
                {c.dirtyCount === 0
                  ? 'nothing waiting to go back'
                  : `${plural(c.dirtyCount, 'local edit')} waiting to go back`}
              </span>
              {c.pushStatus && (
                <span className="faint">last push {c.pushStatus}</span>
              )}
              {c.externalId && (
                <span className="ml-auto flex items-center gap-1">
                  <form action={syncCalendar}>
                    <input type="hidden" name="calendarId" value={c.id} />
                    <button
                      type="submit"
                      className="hairline row-hover rounded border px-2 py-0.5 text-[11px]"
                    >
                      Pull again
                    </button>
                  </form>
                  <form action={pushCalendarEdits}>
                    <input type="hidden" name="calendarId" value={c.id} />
                    <button
                      type="submit"
                      className="hairline row-hover rounded border px-2 py-0.5 text-[11px]"
                      disabled={c.dirtyCount === 0}
                    >
                      Push {c.dirtyCount > 0 ? c.dirtyCount : ''} back
                    </button>
                  </form>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="px-5 py-4">
        <h2 className="faint mb-2 text-[10px] font-semibold uppercase tracking-wider">
          Integrations in use
        </h2>
        <p className="muted mb-2 text-[12px]">
          Every external service sits behind an interface with a fixture-backed fake.
          Orbit runs end to end with none of them configured, and nothing below leaves
          this machine while it says “fake”.
        </p>
        <ul className="flex flex-col gap-1 text-[12px]">
          {summary.map((row) => (
            <li key={row.variable} className="flex items-baseline gap-2">
              <code className="faint">{row.variable}</code>
              <span>{row.name}</span>
              <span className="faint ml-auto">
                {row.isFake ? 'fixture-backed, runs here' : 'real — written, never run here'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
