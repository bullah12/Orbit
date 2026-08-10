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
 * against the database, which needs a query. So the sheet does not offer the
 * space as a choice: it shows which one it landed on as a chip in the read-back
 * row, and the footnote points at `/capture` for changing it. Three radios for
 * a decision that is right by default almost every time is the sheet turning
 * into the page it exists to save you a trip to.
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
  // The space is decided, not chosen here. `/capture` resolves a `#space` hint
  // against the database, which needs a query this sheet cannot make; the chip
  // below says which space it landed on and the footnote says where to change
  // it. Offering three radios for a decision that is right by default almost
  // every time is the sheet becoming the page it is a shortcut to.
  const space = spaces[0];

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button
        type="button"
        aria-label="Close capture"
        onClick={onClose}
        className="absolute inset-0 h-full w-full"
        style={{ background: 'color-mix(in oklab, var(--bg-sunken) 72%, transparent)' }}
      />

      <form
        action={captureCreate}
        role="dialog"
        aria-modal="true"
        aria-label="Capture something"
        className="hairline absolute inset-x-0 bottom-0 max-h-[88%] overflow-y-auto border-t px-5 pt-2.5"
        style={{
          background: 'var(--bg-raised)',
          borderRadius: '1rem 1rem 0 0',
          paddingBottom: 'calc(1.625rem + env(safe-area-inset-bottom))',
        }}
      >
        <span className="sheet-grip" aria-hidden="true" />

        <h2 className="mb-3 text-xl font-semibold tracking-[-0.01em]">Capture</h2>

        <input type="hidden" name="text" value={text} />
        <input type="hidden" name="kind" value={chosenKind} />
        {space && <input type="hidden" name="spaceId" value={space.id} />}

        <label htmlFor="capture-sheet-text" className="sr-only">
          What do you want to capture?
        </label>
        {/* A textarea, not an input: a captured line is often a sentence, and a
            one-line field that scrolls sideways hides the beginning of what you
            just typed. 16px because anything smaller makes iOS zoom the page. */}
        <textarea
          id="capture-sheet-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          autoFocus
          placeholder="“bins out tomorrow”, “dentist a week on Tuesday”"
          className="hairline w-full resize-none rounded-lg border px-3.5 py-3"
          style={{
            background: 'var(--bg)',
            borderColor: 'var(--line-strong)',
            fontSize: '1rem',
            minHeight: '88px',
            color: 'var(--text)',
            fontFamily: 'inherit',
          }}
        />

        <p className="section-label mt-3.5" aria-hidden={text.trim() === ''}>
          {text.trim() === '' ? 'Orbit will read this back' : 'Orbit reads this as'}
        </p>

        {text.trim() === '' ? (
          <p className="faint mt-2 text-sm">
            Type it the way you would say it. Nothing is sent anywhere to read it.
          </p>
        ) : (
          <>
            <p aria-live="polite" className="sr-only">
              {describeCapture({ ...capture, kind: chosenKind })}
            </p>
            <ul id="capture-sheet-matches" className="mt-2 flex flex-wrap gap-2">
              <li>
                <button
                  type="button"
                  onClick={() => setKind(nextKind(chosenKind))}
                  aria-label={`Create it as a ${chosenKind}. Tap to change.`}
                  className="hairline inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm"
                >
                  <Icon name={KIND_ICON[chosenKind]} size={13} className="muted" />
                  {chosenKind[0]!.toUpperCase() + chosenKind.slice(1)}
                </button>
              </li>
              {capture.matches.map((m, i) => (
                <li
                  key={i}
                  className="hairline inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm tabular-nums"
                  title={`“${m.text}” → ${m.meaning}`}
                >
                  <Icon name={FIELD_ICON[m.field]} size={13} className="muted" />
                  {m.meaning}
                </li>
              ))}
              {space && (
                <li className="inline-flex items-center">
                  <SpaceIndicator space={space} />
                </li>
              )}
            </ul>
          </>
        )}

        <div className="mt-4 flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="hairline flex min-h-12 min-w-[92px] items-center justify-center rounded-md border px-4 text-lg"
          >
            Cancel
          </button>
          <SubmitButton
            disabled={!ready}
            className="flex min-h-12 flex-1 items-center justify-center rounded-md text-lg font-medium disabled:opacity-50 btn-primary"
          >
            Capture
          </SubmitButton>
        </div>

        {spaces.length === 0 ? (
          <p className="mt-3 text-sm" style={{ color: 'var(--warning)' }}>
            There is nowhere to put it yet. Everything in Orbit lives in a space
            and you are not in one you can write to.
          </p>
        ) : (
          <p className="faint mt-3 text-sm">
            Opens the full preview on{' '}
            <Link
              href={`/capture${text ? `?text=${encodeURIComponent(text)}` : ''}` as never}
              className="underline underline-offset-2"
            >
              /capture
            </Link>{' '}
            if you want to change what it read.
          </p>
        )}
      </form>
    </div>
  );
}

/** Task → Note → Event → Task. Three options is a cycle, not a dropdown. */
function nextKind(k: 'task' | 'note' | 'event'): 'task' | 'note' | 'event' {
  return k === 'task' ? 'note' : k === 'note' ? 'event' : 'task';
}
