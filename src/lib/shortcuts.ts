/**
 * What each key does, as data.
 *
 * Pure and separate from the component that listens, so the rules can be tested
 * without a DOM — in particular the two that are easy to get wrong and
 * expensive to get wrong: never stealing a key from somebody who is typing, and
 * never stealing one from the browser.
 *
 * `globals.css` justifies the focus ring with the sentence "a dense interface
 * is a keyboard interface". Until this existed the app had one
 * `addEventListener` in `src/` and it was listening for `online`.
 */

export type Shortcut = {
  /** What you press. A two-key sequence is written "g t". */
  keys: string;
  label: string;
  /** Where it goes. Absent for the ones the component handles itself. */
  href?: string;
};

export const GO_TO: Shortcut[] = [
  { keys: 'g t', label: 'Today', href: '/' },
  { keys: 'g c', label: 'Calendar', href: '/calendar/week' },
  { keys: 'g m', label: 'Mine', href: '/tasks/mine' },
  { keys: 'g i', label: 'Inbox', href: '/tasks/inbox' },
  { keys: 'g p', label: 'People', href: '/people' },
  { keys: 'g l', label: 'Places', href: '/places' },
  { keys: 'g n', label: 'Notes', href: '/notes' },
  { keys: 'g r', label: 'Rules', href: '/rules' },
  { keys: 'g s', label: 'Sync', href: '/sync' },
];

export const ACTIONS: Shortcut[] = [
  { keys: '/', label: 'Search', href: '/search' },
  { keys: 'c', label: 'Capture something', href: '/capture' },
  { keys: '?', label: 'This list' },
  { keys: 'Esc', label: 'Close what is open' },
];

/**
 * Whether a keystroke belongs to whatever is focused rather than to the app.
 *
 * Somebody typing "citrus" into a task title must not be sent to the capture
 * page by the c. This is the check that makes single-letter shortcuts safe at
 * all, and it is the reason this file has tests.
 */
export function isTyping(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return el.getAttribute('contenteditable') === '' ||
    el.getAttribute('contenteditable') === 'true';
}

/**
 * Whether the app should ignore the event because the browser owns it.
 *
 * Anything with a modifier is the browser's or the OS's — ⌘L, Ctrl-T, Alt-Left.
 * Taking those makes an app feel broken in a way that is hard to attribute.
 */
export function hasModifier(e: {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean {
  return e.ctrlKey || e.metaKey || e.altKey;
}

/**
 * The destination for a key, given whatever `g` prefix is outstanding.
 *
 * Returns what to do rather than doing it, so the sequence logic is testable:
 *   - `{ kind: 'go', href }`      navigate there
 *   - `{ kind: 'pending' }`       a prefix was started, wait for the second key
 *   - `{ kind: 'help' }`          show the list
 *   - `{ kind: 'none' }`          not ours; leave it alone
 */
export type Resolution =
  | { kind: 'go'; href: string }
  | { kind: 'pending' }
  | { kind: 'help' }
  | { kind: 'none' };

export function resolve(key: string, pending: string | null): Resolution {
  if (pending === 'g') {
    const match = GO_TO.find((s) => s.keys === `g ${key.toLowerCase()}`);
    return match?.href ? { kind: 'go', href: match.href } : { kind: 'none' };
  }

  if (key === 'g') return { kind: 'pending' };
  if (key === '?') return { kind: 'help' };

  const match = ACTIONS.find((s) => s.keys === key && s.href);
  return match?.href ? { kind: 'go', href: match.href } : { kind: 'none' };
}
