import { requireUser } from '@/lib/auth';
import { listSpaces } from '@/lib/queries/spaces';
import { listDevices } from '@/lib/queries/sync';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { formatRelative } from '@/lib/format';
import { setDefaultSpace, setDeviceRevocation, setTheme, setWeekStart } from '@/app/actions';
import { thisDeviceLabel } from '@/lib/sync/device';
import { THEME_CHOICES, WEEK_STARTS, resolveDefaultSpace } from '@/lib/prefs';
import { readDefaultSpaceRaw, readTheme, readWeekStart } from '@/lib/prefs/cookies';

export const dynamic = 'force-dynamic';

/**
 * Settings.
 *
 * Administrative, which is why it lives under **More** beside Rules, Sync and
 * AI rather than beside Today. Nothing on this page is something you do daily.
 *
 * Built entirely from existing tokens and no new colour: the only strong colour
 * on it is the space indicator on a device row, which is category colour doing
 * the job it always does. A revoked device is told apart by shape and by a
 * word, not by going red — it is a state somebody chose, not a warning.
 *
 * Three preferences and one write. The preferences are cookies, so this page
 * needed no migration; `src/lib/prefs/index.ts` records why, and what it costs
 * (a preference belongs to a browser, not to an account).
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const user = await requireUser();

  const [spaces, devices, theme, weekStart, defaultSpaceRaw, myLabel] = await Promise.all([
    listSpaces(user.id),
    listDevices(user.id),
    readTheme(),
    readWeekStart(),
    readDefaultSpaceRaw(),
    thisDeviceLabel(),
  ]);

  const writable = spaces.filter((s) => s.canWrite);
  const defaultSpace = resolveDefaultSpace(defaultSpaceRaw, writable.map((s) => s.id));

  // A cookie naming a space the person can no longer write to is not an error
  // to shout about, but saying nothing would leave them wondering why the
  // compose bar ignores their choice.
  const staleSpace = defaultSpaceRaw !== null && defaultSpaceRaw !== '' && defaultSpace === null;

  // One browser is one row per space, so "this browser" is a set.
  const mine = myLabel === null ? [] : devices.filter((d) => d.label === myLabel);
  const activeMine = mine.filter((d) => d.revokedAt === null);

  const SAVED: Record<string, string> = {
    theme: 'Theme saved. It is applied by the server before the page is painted, so there is no flash.',
    week: 'Week start saved. It changes how the calendar is laid out, not what any event repeats on.',
    space: 'Default space saved.',
    revoked: 'Device revoked. It has stopped advancing its sync cursor.',
    restored: 'Device restored. It will advance its cursor again.',
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="hairline border-b px-5 py-4">
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="muted mt-0.5 max-w-[var(--measure)] text-xs">
          How Orbit looks and behaves in this browser, and which devices are
          allowed to keep syncing. The three preferences are stored in this
          browser rather than on your account, so a second device starts at the
          defaults — deliberate for a theme, a mild annoyance for the rest.
        </p>
      </header>

      <div aria-live="polite" className="empty:hidden">
        {error && (
          <p
            role="alert"
            className="hairline border-b px-5 py-2 text-xs"
            style={{ background: 'var(--c-amber-bg)', color: 'var(--c-amber)' }}
          >
            {error}
          </p>
        )}
        {!error && saved && SAVED[saved] && (
          <p className="hairline muted border-b px-5 py-2 text-xs">{SAVED[saved]}</p>
        )}
      </div>

      <div className="w-full max-w-[var(--measure)]">
        {/* ----------------------------------------------------------- theme */}
        <section className="hairline border-b px-5 py-4" aria-labelledby="theme-heading">
          <h2 id="theme-heading" className="text-sm font-semibold">
            Theme
          </h2>
          <p className="muted mt-1 text-xs">
            Orbit has always followed your device. It can be pinned instead.
            Every colour in the stylesheet holds both its values in one
            declaration, so pinning a theme picks the other half of all
            forty-two of them — there is no second palette that could drift out
            of step with the first.
          </p>

          <form action={setTheme} className="seg mt-3 inline-flex" role="group" aria-label="Theme">
            {THEME_CHOICES.map((choice) => (
              <button
                key={choice}
                name="theme"
                value={choice}
                type="submit"
                aria-current={theme === choice ? 'true' : undefined}
                className="capitalize"
              >
                {choice}
              </button>
            ))}
          </form>

          <p className="faint mt-2 text-2xs">
            Currently <strong>{theme}</strong>
            {theme === 'system'
              ? ' — whichever your operating system is asking for, changing with it.'
              : ' — pinned, whatever your operating system asks for.'}
          </p>
        </section>

        {/* ------------------------------------------------------- week start */}
        <section className="hairline border-b px-5 py-4" aria-labelledby="week-heading">
          <h2 id="week-heading" className="text-sm font-semibold">
            Week starts on
          </h2>
          <p className="muted mt-1 text-xs">
            Which day the calendar’s week and month grids begin on. This is a
            layout choice and nothing more: it does not change what a repeating
            event repeats on. A rule that says “every week from Monday” carries
            its own start day (<code className="text-2xs">WKST</code>), which
            belongs to the rule rather than to whoever is looking at it — so
            changing this can never quietly move somebody’s occurrences.
          </p>

          <form
            action={setWeekStart}
            className="seg mt-3 inline-flex"
            role="group"
            aria-label="Week starts on"
          >
            {WEEK_STARTS.map((day) => (
              <button
                key={day}
                name="weekStart"
                value={day}
                type="submit"
                aria-current={weekStart === day ? 'true' : undefined}
                className="capitalize"
              >
                {day}
              </button>
            ))}
          </form>
        </section>

        {/* ---------------------------------------------------- default space */}
        <section className="hairline border-b px-5 py-4" aria-labelledby="space-heading">
          <h2 id="space-heading" className="text-sm font-semibold">
            Default space for new items
          </h2>
          <p className="muted mt-1 text-xs">
            Which space the compose bar starts in when the page has not already
            picked one — opening a space’s own list still wins, because you are
            standing in it. Only spaces you can write to are offered, and the
            choice is re-checked against that list every time it is read, so a
            space you later leave falls back rather than failing.
          </p>

          {staleSpace && (
            <p className="muted mt-2 text-xs">
              The space saved here is no longer one you can write to, so the
              compose bar is falling back to your first writable space. Choose
              again to replace it.
            </p>
          )}

          <form action={setDefaultSpace} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="faint text-2xs">Space</span>
              <select name="spaceId" defaultValue={defaultSpace ?? ''} className="input text-xs">
                <option value="">No preference — the first one</option>
                {writable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="hairline rounded border px-2.5 py-1 text-xs">
              Save
            </button>
          </form>
        </section>

        {/* --------------------------------------------------------- devices */}
        <section className="px-5 py-4" aria-labelledby="devices-heading">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 id="devices-heading" className="text-sm font-semibold">
              Devices
            </h2>
            <span className="faint text-xs">
              {devices.length} row{devices.length === 1 ? '' : 's'}
            </span>
          </div>
          <p className="muted mt-1 text-xs">
            Naming a browser on <a href="/sync">Sync</a> writes one row per space
            you can write to, because a sync cursor is space-scoped. Revoking a
            row stops it advancing that cursor — it is not a sign-out and it
            takes no permission away, it ends a device’s claim to be caught up.
            Restoring it is one press, and a revoked device that names itself
            again comes back by itself.
          </p>

          {mine.length > 0 && (
            <form action={setDeviceRevocation} className="mt-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="label" value={myLabel ?? ''} />
              <input type="hidden" name="revoked" value={activeMine.length > 0 ? '1' : '0'} />
              <span className="muted text-xs">
                This browser is <strong>{myLabel}</strong>, which is {mine.length}{' '}
                {mine.length === 1 ? 'row' : 'rows'}.
              </span>
              <button type="submit" className="hairline rounded border px-2.5 py-1 text-xs">
                {activeMine.length > 0 ? 'Revoke all of them' : 'Restore all of them'}
              </button>
            </form>
          )}

          {devices.length === 0 ? (
            <p className="muted mt-3 text-xs">
              No devices yet. Name this browser on <a href="/sync">Sync</a> and a
              row appears for each space you can write to.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col">
              {devices.map((d) => {
                const revoked = d.revokedAt !== null;
                return (
                  <li
                    key={d.id}
                    className="hairline flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-2 last:border-b-0"
                  >
                    <SpaceIndicator space={d.space} />
                    <span className={revoked ? 'muted text-sm line-through' : 'text-sm font-medium'}>
                      {d.label}
                    </span>
                    {myLabel === d.label && <span className="faint text-2xs">this browser</span>}
                    <span className="faint text-2xs">{d.platform}</span>

                    {/* A revoked row says so in a word and by shape. No red:
                        this is a state somebody chose, not a warning. */}
                    {revoked ? (
                      <span className="muted inline-flex items-center gap-1 text-2xs">
                        <Icon name="eye_off" size={10} />
                        revoked {formatRelative(d.revokedAt!)}
                      </span>
                    ) : (
                      <span className="faint text-2xs">
                        {d.lastSeenAt ? `last seen ${formatRelative(d.lastSeenAt)}` : 'never seen'}
                      </span>
                    )}

                    <form action={setDeviceRevocation} className="ml-auto">
                      <input type="hidden" name="deviceId" value={d.id} />
                      <input type="hidden" name="revoked" value={revoked ? '0' : '1'} />
                      <button type="submit" className="hairline rounded border px-2.5 py-1 text-xs">
                        {revoked ? 'Restore' : 'Revoke'}
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
