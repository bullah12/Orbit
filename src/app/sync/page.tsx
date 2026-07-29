import { requireUser } from '@/lib/auth';
import { listSpaces } from '@/lib/queries/spaces';
import { changesSince, listCursors, listDevices } from '@/lib/queries/sync';
import { SYNC_ENTITY_KINDS } from '@/lib/sync/conflict';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { OutboxPanel } from '@/components/OutboxPanel';
import { formatRelative } from '@/lib/format';
import { catchUpDevice, rewindDevice } from '@/app/actions';
import { asUser } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Sync.
 *
 * Two halves that meet in the middle. The top is the *client's* — a queue of
 * edits this browser has not sent, and the conflicts that came back — and is
 * the only surface in Orbit rendered from `localStorage` rather than from a
 * query, because that is genuinely where an unsent edit is.
 *
 * The bottom is the server's: which devices exist, how far each has caught up
 * with each space, and what has changed since. Both halves carry the space
 * indicator on every row, on the same terms as a task row or a calendar block.
 *
 * A cursor is not a permission. Every row here comes back through `asUser`, so
 * a device belonging to somebody whose space you cannot read is not shown as
 * "hidden" — it does not exist, as far as this page is concerned.
 */
export default async function SyncPage({
  searchParams,
}: {
  searchParams: Promise<{ device?: string }>;
}) {
  const { device: chosenDevice } = await searchParams;
  const user = await requireUser();

  const [spaces, devices, cursors] = await Promise.all([
    listSpaces(user.id),
    listDevices(user.id),
    listCursors(user.id),
  ]);

  const device = devices.find((d) => d.id === chosenDevice) ?? devices[0] ?? null;

  // The instant the page was read. `catchUpDevice` writes exactly this, so
  // "caught up" means "up to what was on this screen" rather than "up to
  // whenever the button happened to be pressed" — anything written in between
  // is still ahead of the cursor and will be there next time.
  const [{ now }] = await asUser(user.id, async (tx) => tx<{ now: string }[]>`select now() as now`);

  const cursorsForDevice = device ? cursors.filter((c) => c.deviceId === device.id) : [];
  const earliest = cursorsForDevice.reduce<string | null>(
    (acc, c) => (acc === null || c.cursorAt < acc ? c.cursorAt : acc),
    null,
  );

  const changes =
    device && earliest ? await changesSince(user.id, device.spaceId, earliest, 40) : [];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="hairline border-b px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-[15px] font-semibold">Sync</h1>
          <span className="faint text-[12px]">
            {devices.length} device{devices.length === 1 ? '' : 's'}, {cursors.length} cursor
            {cursors.length === 1 ? '' : 's'}
          </span>
        </div>
        <p className="muted mt-0.5 text-[12px]">
          What this browser has not sent yet, and how far each device has caught
          up with each space. Nothing here is ever resolved silently: an edit
          that clashes with somebody else’s is held with both versions kept,
          and answering it is something you do on purpose.
        </p>
      </header>

      <OutboxPanel spaces={spaces} serverNow={now} />

      <section className="hairline border-b px-5 py-4" aria-labelledby="devices-heading">
        <h2 id="devices-heading" className="text-[13px] font-semibold">
          Devices
        </h2>
        {devices.length === 0 ? (
          <p className="muted mt-1 text-[12px]">
            No devices are registered to this account. A cursor belongs to a
            device, so there is nothing to be behind.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2" id="sync-devices">
            {devices.map((d) => (
              <li key={d.id}>
                <a
                  href={`/sync?device=${d.id}`}
                  aria-current={device?.id === d.id ? 'true' : undefined}
                  className="hairline flex items-center gap-2 rounded border px-2.5 py-1.5 text-[12px]"
                  style={
                    device?.id === d.id
                      ? { background: 'var(--bg-raised)', borderColor: 'var(--text-faint)' }
                      : undefined
                  }
                >
                  <SpaceIndicator space={d.space} />
                  <span className="font-medium">{d.label}</span>
                  <span className="faint text-[11px]">
                    {d.lastSeenAt ? `seen ${formatRelative(d.lastSeenAt)}` : 'never seen'}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {device && (
        <section className="hairline border-b px-5 py-4" aria-labelledby="cursors-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="cursors-heading" className="text-[13px] font-semibold">
              How far <span className="font-normal">{device.label}</span> has caught up
            </h2>
            <SpaceIndicator space={device.space} />
          </div>

          {cursorsForDevice.length === 0 ? (
            <p className="muted mt-1 text-[12px]">
              This device has no cursors yet, so its next sync reads everything.
            </p>
          ) : (
            <table className="mt-2 w-full text-[12px]" id="sync-cursors">
              <caption className="sr-only">One cursor per kind for {device.label}</caption>
              <thead>
                <tr className="faint text-left text-[11px]">
                  <th scope="col" className="py-1 pr-3 font-medium">Kind</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Caught up to</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Last sync</th>
                  <th scope="col" className="py-1 font-medium">Changed since</th>
                </tr>
              </thead>
              <tbody>
                {SYNC_ENTITY_KINDS.map((kind) => {
                  const c = cursorsForDevice.find((x) => x.entityKind === kind);
                  const n = c ? changes.filter((ch) => ch.entityKind === kind && ch.updatedAt > c.cursorAt).length : 0;
                  return (
                    <tr key={kind} className="hairline border-t">
                      <th scope="row" className="py-1 pr-3 text-left font-medium">{kind}</th>
                      <td className="py-1 pr-3">{c ? formatRelative(c.cursorAt) : 'never'}</td>
                      <td className="muted py-1 pr-3">
                        {c?.lastSyncAt ? formatRelative(c.lastSyncAt) : '—'}
                      </td>
                      <td className="py-1">{n === 0 ? 'nothing' : `${n}${n === 40 ? '+' : ''}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <form action={catchUpDevice}>
              <input type="hidden" name="deviceId" value={device.id} />
              <input type="hidden" name="spaceId" value={device.spaceId} />
              <input type="hidden" name="upTo" value={now} />
              <button type="submit" className="hairline rounded border px-2.5 py-1 text-[12px]">
                Mark caught up
              </button>
            </form>
            <form action={rewindDevice}>
              <input type="hidden" name="deviceId" value={device.id} />
              <input type="hidden" name="spaceId" value={device.spaceId} />
              <button type="submit" className="hairline rounded border px-2.5 py-1 text-[12px]">
                Rewind to the beginning
              </button>
            </form>
            <span className="faint self-center text-[11px]">
              A cursor only ever moves forward when it is advanced — rewinding is a
              separate, deliberate thing, and it makes the next sync read the lot.
            </span>
          </div>
        </section>
      )}

      {device && (
        <section className="px-5 py-4" aria-labelledby="changes-heading">
          <h2 id="changes-heading" className="text-[13px] font-semibold">
            Changed since this device last caught up
          </h2>
          {changes.length === 0 ? (
            <p className="muted mt-1 text-[12px]" id="sync-changes-none">
              Nothing has changed in {device.space.name} since this device last
              read it.
            </p>
          ) : (
            <ul className="mt-2 space-y-1" id="sync-changes">
              {changes.map((c) => (
                <li
                  key={`${c.entityKind}-${c.entityId}`}
                  className="hairline flex flex-wrap items-center gap-2 rounded border px-2.5 py-1.5 text-[12px]"
                >
                  <SpaceIndicator space={c.space} />
                  <span className="hairline rounded border px-1.5 py-0.5 text-[11px]">{c.entityKind}</span>
                  <span className="font-medium">
                    {c.isLocked ? (
                      <span className="faint inline-flex items-center gap-1">
                        <Icon name="lock" size={11} /> locked — no plaintext to show
                      </span>
                    ) : (
                      c.title || 'Untitled'
                    )}
                  </span>
                  <span className="faint ml-auto text-[11px]">{formatRelative(c.updatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="faint mt-2 text-[11px]">
            A locked row is listed rather than hidden: a device that never hears
            it changed can never fetch its ciphertext either. Its title is empty
            on the server by constraint, so there is nothing to show and nothing
            leaked by saying it moved.
          </p>
        </section>
      )}
    </div>
  );
}
