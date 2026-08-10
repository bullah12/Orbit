'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Icon } from './Icon';
import { SpaceIndicator } from './SpaceIndicator';
import { SubmitButton } from './SubmitButton';
import { captureCreate } from '@/app/actions';
import { parseCapture, describeCapture, type CaptureMatch } from '@/lib/capture';
import type { SpaceSummary } from '@/lib/queries/spaces';

/**
 * Capture, on a phone.
 *
 * It used to be a tab, which cost a sixth of the bar to say "plus". As a
 * floating button it is over every tab instead of beside three of them, and
 * the bar gets its width back.
 *
 * Rendered once from the root layout so no page has to remember to offer it —
 * the same argument that put `CaptureBar` there, which is still what a wide
 * screen gets. This is `md:hidden`; the bar is hidden below `md`. One of the
 * two is on screen at any width, never both.
 *
 * Two things about the position are load-bearing:
 *
 * - It clears the bar *and* the home indicator by sitting on `--tabbar`, which
 *   is the one token both this and `<main>`'s bottom padding read. They were
 *   two numbers in two files once, which is how a button ends up half behind
 *   a tab.
 * - The 4px `--bg` ring is the third `box-shadow` in the app, and the
 *   stylesheet's elevation note says there are two. It is here for the reason
 *   the other two are: it separates the button from a substrate the palette
 *   cannot predict — in this case whatever list row happens to be scrolling
 *   underneath it. It is a hard-edged ring, not a shadow, and nothing about it
 *   is decorative.
 *
 * Suppressed on the People map view, where the bottom sheet owns that corner.
 * That is the one place a fixed button in the bottom-right would land on top
 * of something a person is reading rather than on top of a list they are
 * scrolling past.
 */
export function CaptureFab({ spaces }: { spaces: SpaceSummary[] }) {
  const pathname = usePathname();
  const view = useSearchParams().get('view');
  const [open, setOpen] = useState(false);

  // Closing on navigation: the sheet posts a server action that redirects, and
  // without this it would still be up over whatever it landed on.
  useEffect(() => setOpen(false), [pathname]);

  if (pathname === '/people' && view === 'map') return null;
  // On the capture page itself it would be a button to the page you are on.
  if (pathname === '/capture') return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Capture something"
        aria-expanded={open}
        className="fab md:hidden"
      >
        <Icon name="plus" size={26} strokeWidth={2} />
      </button>
      {open && <CaptureSheet spaces={spaces} onClose={() => setOpen(false)} />}
    </>
  );
}

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
 * The sheet, and why it is allowed to exist at all.
 *
 * `/capture` is the surface, and it stays the surface: it is a plain GET with
 * no client JavaScript, it works on first paint, it works offline behind the
 * service worker's shell, and the FAB's "Open the full page" goes there with
 * whatever has been typed. Nothing here replaces it.
 *
 * What this adds is the round trip. Capture is the thing somebody does most,
 * and on a phone "navigate away from what you were reading, type, read the
 * parse, create, navigate back" is four screens for one sentence. The sheet is
 * the same parse over the page you are already on.
 *
 * **The parse is the same parse.** `parseCapture` is a pure module with no
 * network import — that is a promise the directory keeps and a test enforces —
 * so it runs here in the browser and on the server for `/capture`, and it is
 * one function over one string either way. The preview cannot disagree with
 * the page. The create posts `captureCreate`, which is the same server action
 * the page's own form posts.
 *
 * The one thing `/capture` does that this does not is resolve a `#space` hint
 * against the database, which needs a query. The hint still shows in the chips
 * as something the parser read; it just does not preselect a space here. The
 * space radios are right underneath and the full page is one tap away.
 *
 * A dialog, so it takes focus and Escape closes it — this one does cover the
 * page, unlike the map's sheet.
 */
function CaptureSheet({
  spaces,
  onClose,
}: {
  spaces: SpaceSummary[];
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const capture = parseCapture(text);
  const [kind, setKind] = useState<'task' | 'note' | 'event' | null>(null);
  const chosenKind = kind ?? capture.kind;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const ready = capture.title.length > 0 && spaces.length > 0;

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button
        type="button"
        aria-label="Close capture"
        onClick={onClose}
        className="absolute inset-0 h-full w-full"
        style={{ background: 'color-mix(in oklab, var(--bg-sunken) 72%, transparent)' }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Capture something"
        className="hairline absolute inset-x-0 bottom-0 max-h-[85%] overflow-y-auto rounded-t-lg border-t px-4 pt-3"
        style={{
          background: 'var(--bg-raised)',
          paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))',
        }}
      >
        <div className="mb-3 flex items-center gap-2">
          <h2 className="section-label flex-1">Capture</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="row-hover flex h-9 w-9 items-center justify-center rounded"
          >
            <Icon name="x" size={16} className="muted" />
          </button>
        </div>

        <label htmlFor="capture-sheet-text" className="sr-only">
          What do you want to capture?
        </label>
        <input
          id="capture-sheet-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          autoComplete="off"
          placeholder="“bins out tomorrow”, “dentist a week on Tuesday”"
          className="input"
          style={{ fontSize: '1rem', paddingBlock: '0.625rem' }}
        />

        <p aria-live="polite" className="mt-2 text-sm">
          {text.trim() === '' ? (
            <span className="faint">
              Type it the way you would say it. Nothing is sent anywhere to read it.
            </span>
          ) : (
            <>
              <Icon name={KIND_ICON[chosenKind]} size={13} className="muted inline" />{' '}
              {describeCapture({ ...capture, kind: chosenKind })}
            </>
          )}
        </p>

        {capture.matches.length > 0 && (
          <ul id="capture-sheet-matches" className="mt-2 flex flex-wrap gap-1.5">
            {capture.matches.map((m, i) => (
              <li
                key={i}
                className="hairline inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs"
              >
                <Icon name={FIELD_ICON[m.field]} size={11} className="muted" />
                <span className="faint">{m.text}</span>
                <Icon name="arrow_right" size={10} className="faint" />
                <span>{m.meaning}</span>
              </li>
            ))}
          </ul>
        )}

        <form action={captureCreate} className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="text" value={text} />

          <fieldset className="flex flex-wrap items-center gap-3">
            <legend className="section-label mb-1">Create it as</legend>
            {(['task', 'note', 'event'] as const).map((k) => (
              <label key={k} className="flex min-h-11 items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="kind"
                  value={k}
                  checked={k === chosenKind}
                  onChange={() => setKind(k)}
                />
                <Icon name={KIND_ICON[k]} size={13} className="muted" />
                {k[0]!.toUpperCase() + k.slice(1)}
              </label>
            ))}
          </fieldset>

          <fieldset className="flex flex-wrap items-center gap-3">
            <legend className="section-label mb-1">Into</legend>
            {spaces.map((s, i) => (
              <label key={s.id} className="flex min-h-11 items-center gap-1.5">
                <input type="radio" name="spaceId" value={s.id} defaultChecked={i === 0} />
                <SpaceIndicator space={s} />
              </label>
            ))}
            {spaces.length === 0 && (
              <span className="muted text-sm">
                nowhere yet — everything lives in a space, and you are not in one
                you can write to
              </span>
            )}
          </fieldset>

          <div className="flex items-center gap-3">
            <SubmitButton
              icon="plus"
              disabled={!ready}
              className="inline-flex min-h-11 items-center gap-1.5 rounded px-3 text-sm disabled:opacity-50 btn-primary"
            >
              Create it
            </SubmitButton>
            {/* The surface this is a shortcut to. It resolves a #space hint
                against the database, which needs a query — and it works with
                no JavaScript at all, which this cannot. */}
            <Link
              href={`/capture${text ? `?text=${encodeURIComponent(text)}` : ''}` as never}
              className="muted text-sm underline underline-offset-2"
            >
              Open the full page
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
