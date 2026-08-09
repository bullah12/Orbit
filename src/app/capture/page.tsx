import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listSpaces } from '@/lib/queries/spaces';
import { resolveSpaceHint } from '@/lib/queries/capture';
import { parseCapture, describeCapture, type CaptureMatch } from '@/lib/capture';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { captureCreate } from '@/app/actions';

export const dynamic = 'force-dynamic';

const FIELD_ICON: Record<CaptureMatch['field'], string> = {
  kind: 'note',
  date: 'calendar',
  time: 'clock',
  duration: 'clock',
  priority: 'alert',
  space: 'house',
  assignee: 'user',
};

const KIND_ICON = { task: 'check', note: 'note', event: 'calendar' } as const;

/**
 * Capture.
 *
 * One line in, one thing out — and in between, the parser shows its working.
 * Every phrase it took out of the title comes back as a chip saying what it
 * took it to mean, because "a week on Tuesday" resolving to the wrong Tuesday
 * is exactly the kind of mistake nobody notices until the day after.
 *
 * **Nothing here is AI and nothing leaves the device.** The parsing is a pure
 * module with no network import (decision 8, ADR section 7); the only thing
 * this page sends anywhere is the row it eventually writes to Postgres. There
 * is a test that reads the parser's source back and fails if that stops being
 * true.
 *
 * The preview is a plain GET — type, press Preview, read it, then create. No
 * client JavaScript, which also means the parse you read and the parse that
 * runs are produced by one function on one string.
 */
export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<{ text?: string; space?: string; kind?: string; error?: string }>;
}) {
  const { text = '', space = '', kind = '', error } = await searchParams;
  const user = await requireUser();
  const spaces = (await listSpaces(user.id)).filter((s) => s.canWrite);

  const capture = parseCapture(text);
  const hinted = await resolveSpaceHint(user.id, capture.spaceHint);
  const chosenSpaceId = space || hinted || spaces[0]?.id || '';
  const chosenKind = (kind || capture.kind) as 'task' | 'note' | 'event';

  // Two reasons the button is off, and they used to share one sentence: "There
  // is nothing here but a date." That is true of a line that parsed to no
  // title, and completely wrong for somebody whose account has no space to
  // write to — which is every real account until it makes one, since a profile
  // is created at sign-up and a space is not. Being told to type more words
  // when the words were never the problem is the whole of the bug.
  const blocked =
    capture.title.length === 0
      ? ('no-title' as const)
      : chosenSpaceId === ''
        ? ('no-space' as const)
        : null;
  const ready = blocked === null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="hairline border-b px-5 py-4">
        <h1 className="text-lg font-semibold">Capture</h1>
        <p className="muted mt-0.5 text-xs">
          Type it the way you would say it. “Put the bins out tomorrow”, “a week
          on Tuesday call the dentist”, “dinner with Sadia on Saturday at 7pm”.
          Use <code>#space</code>, <code>@person</code> and <code>!priority</code>{' '}
          if you want to be exact.
        </p>
        <p className="faint mt-1 inline-flex items-center gap-1 text-2xs">
          <Icon name="lock" size={11} />
          Parsed on this machine. Nothing you type here is sent anywhere, and no
          AI reads it.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="hairline border-b px-5 py-2 text-xs"
          style={{ background: 'var(--c-amber-bg)', color: 'var(--c-amber)' }}
        >
          {error}
        </p>
      )}

      {/* Said before anything is typed, because somebody arriving on a fresh
          account would otherwise write the line first and find out after. The
          version under the button says it again with the line in hand, and
          carries it back here afterwards. */}
      {spaces.length === 0 && (
        <p
          role="status"
          className="hairline border-b px-5 py-2 text-xs"
          style={{ background: 'var(--c-amber-bg)', color: 'var(--c-amber)' }}
        >
          You are not in a space you can write to, so nothing can be created yet.{' '}
          <Link href="/spaces?next=%2Fcapture" className="underline">
            Make a space first
          </Link>
          .
        </p>
      )}

      <form
        method="get"
        action="/capture"
        aria-label="Capture something"
        className="hairline flex flex-wrap items-center gap-2 border-b px-5 py-3"
      >
        <label htmlFor="capture-text" className="sr-only">
          What do you want to capture?
        </label>
        <input
          id="capture-text"
          name="text"
          type="text"
          defaultValue={text}
          autoFocus
          placeholder="a week on Tuesday call the dentist"
          className="input"
          style={{ width: '28rem' }}
        />
        <button
          type="submit"
          className="hairline inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-sm"
        >
          <Icon name="arrow_right" size={13} />
          Read it back
        </button>
      </form>

      <section className="px-5 py-4" aria-labelledby="capture-preview-heading">
        <h2 id="capture-preview-heading" className="text-sm font-semibold">
          What this would create
        </h2>

        {!text.trim() ? (
          <p className="muted mt-1 text-xs">
            Nothing yet. Type a line above and press <strong>Read it back</strong>.
          </p>
        ) : (
          <>
            <p aria-live="polite" className="mt-1 text-sm">
              <Icon name={KIND_ICON[chosenKind]} size={13} className="muted inline" />{' '}
              {describeCapture({ ...capture, kind: chosenKind })}
            </p>

            {capture.matches.length > 0 ? (
              <ul id="capture-matches" className="mt-2 flex flex-wrap gap-1.5">
                {capture.matches.map((m, i) => (
                  <li
                    key={i}
                    className="hairline inline-flex items-center gap-1.5 rounded border px-2 py-1 text-2xs"
                  >
                    <Icon name={FIELD_ICON[m.field]} size={11} className="muted" />
                    <span className="faint">{m.text}</span>
                    <Icon name="arrow_right" size={10} className="faint" />
                    <span>{m.meaning}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="faint mt-2 text-2xs">
                Nothing in that line was read as a date, a time or a marker — it
                is all title.
              </p>
            )}

            {capture.spaceHint && !hinted && (
              <p
                role="alert"
                className="mt-2 text-2xs"
                style={{ color: 'var(--c-amber)' }}
              >
                There is no space called “{capture.spaceHint}” that you can write
                to. Pick one below instead.
              </p>
            )}

            <form
              action={captureCreate}
              className="mt-4 flex flex-col gap-3"
              aria-label="Create what was captured"
            >
              <input type="hidden" name="text" value={text} />

              <fieldset className="flex flex-wrap items-center gap-3">
                <legend className="faint text-2xs font-semibold uppercase tracking-wider">
                  Create it as
                </legend>
                {(['task', 'note', 'event'] as const).map((k) => (
                  <label key={k} className="flex items-center gap-1.5 text-xs">
                    <input type="radio" name="kind" value={k} defaultChecked={k === chosenKind} />
                    <Icon name={KIND_ICON[k]} size={12} className="muted" />
                    {k[0].toUpperCase() + k.slice(1)}
                  </label>
                ))}
              </fieldset>

              {/* The space indicator is on the compose surface, not only on the
                  rows — what you capture is readable by everyone in the space
                  you put it in, so the choice has to be legible while you make
                  it. */}
              <fieldset className="flex flex-wrap items-center gap-3">
                <legend className="faint text-2xs font-semibold uppercase tracking-wider">
                  Into
                </legend>
                {spaces.map((s) => (
                  <label key={s.id} className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="spaceId"
                      value={s.id}
                      defaultChecked={s.id === chosenSpaceId}
                    />
                    <SpaceIndicator space={s} />
                  </label>
                ))}
                {spaces.length === 0 && (
                  <span className="muted text-xs">
                    nowhere yet — everything lives in a space, and you are not in
                    one you can write to
                  </span>
                )}
              </fieldset>

              <div>
                <button
                  type="submit"
                  disabled={!ready}
                  className="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm disabled:opacity-50"
                  style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
                >
                  <Icon name="plus" size={13} />
                  Create it
                </button>
                {blocked === 'no-title' && (
                  <p className="faint mt-1 text-2xs">
                    There is nothing here but a date. Type what it is as well.
                  </p>
                )}
                {blocked === 'no-space' && (
                  <p className="mt-1 text-2xs" style={{ color: 'var(--c-amber)' }}>
                    The line is fine — there is just nowhere to put it. Everything
                    in Orbit lives in a space and you are not in one you can write
                    to yet.{' '}
                    <Link
                      href={`/spaces?next=${encodeURIComponent(
                        `/capture?text=${encodeURIComponent(text)}`,
                      )}`}
                      className="underline"
                    >
                      Make a space
                    </Link>{' '}
                    and you will come straight back here with this line still
                    typed.
                  </p>
                )}
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
