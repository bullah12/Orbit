import Link from 'next/link';
import { Icon } from './Icon';

/**
 * Capture, at the top of every page.
 *
 * The thing somebody does most often was, until this existed, the thing they
 * had to navigate to: a link in the rail on a wide screen and a tab at the
 * bottom on a narrow one, both of which mean leaving whatever you were reading
 * before you can write down the thing you just remembered. The cost of that is
 * not the click, it is the ideas that do not get written down.
 *
 * So it is a bar, in the one place that is the same on every screen, and it is
 * a `GET` to `/capture` carrying the line as `text` — which is exactly what the
 * capture page's own form does. Typing here and pressing Enter lands on the
 * preview with the parse already done: one surface, reached from anywhere,
 * showing its working before anything is written.
 *
 * No client JavaScript, deliberately. A plain form works on the first paint,
 * before hydration, and offline the service worker's shell still renders it.
 *
 * `spaceCount` is here so the bar can be honest on an account that cannot yet
 * write anywhere: it points at the space form instead of pretending.
 */
export function CaptureBar({
  spaceCount,
  pathname,
}: {
  spaceCount: number;
  pathname: string;
}) {
  // Not on the capture page itself, where it would be the same field twice,
  // one above the other, and the lower one is the one holding what you typed.
  if (pathname === '/capture') return null;

  if (spaceCount === 0) {
    return (
      <div
        className="hairline sticky top-0 z-20 flex items-center gap-2 border-b px-3 py-2 text-xs"
        style={{ background: 'var(--bg-raised)' }}
      >
        <Icon name="alert" size={13} className="muted" />
        <span className="muted">Nothing can be captured until you are in a space.</span>
        <Link
          href="/spaces"
          className="hairline inline-flex items-center gap-1 rounded border px-2 py-0.5"
        >
          <Icon name="plus" size={11} />
          Make one
        </Link>
      </div>
    );
  }

  return (
    <form
      method="get"
      action="/capture"
      aria-label="Capture something from anywhere"
      className="hairline sticky top-0 z-20 flex items-center gap-2 border-b px-3 py-2"
      style={{ background: 'var(--bg-raised)' }}
    >
      <label htmlFor="capture-bar-text" className="sr-only">
        What do you want to capture?
      </label>
      <input
        id="capture-bar-text"
        name="text"
        type="text"
        placeholder="Capture — “bins out tomorrow”, “dentist a week on Tuesday”"
        className="input min-w-0 flex-1"
        style={{ maxWidth: '32rem' }}
      />
      <button
        type="submit"
        className="inline-flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1.5 text-sm"
        style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
      >
        <Icon name="plus" size={13} />
        Capture
      </button>
      {/* The key that already did this, said out loud. It is in the shortcuts
          list, which nobody reads until they know there is one. */}
      <span className="faint hidden shrink-0 text-2xs sm:inline">
        or press <kbd>c</kbd>
      </span>
    </form>
  );
}
