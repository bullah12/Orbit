'use client';

import { useFormStatus } from 'react-dom';
import { Icon } from './Icon';

/**
 * A submit button that admits it is working.
 *
 * Hover and press are CSS (see `globals.css`), and they answer the first half of
 * "I can't tell whether I pressed it". This is the other half: every write in
 * Orbit is a server action, so between the click and the new HTML there is a
 * round trip during which a plain button looks exactly as it did before it was
 * pressed. On a local database that is 80ms and nobody notices. On a phone on a
 * train it is long enough to press again — and pressing "Create it" twice makes
 * two tasks.
 *
 * So while the action is in flight the button is disabled, marked `aria-busy`,
 * and its icon is replaced by a turning one. It is the only reason this file is
 * a Client Component: `useFormStatus` reads the state of the enclosing `<form>`,
 * which means this must be *inside* the form it belongs to, and the form itself
 * stays a Server Component.
 *
 * **The label never changes.** A button that says "Create it" and then "Saving…"
 * moves under the pointer and reads as a different control; the spinner says the
 * same thing without the layout shifting. It also keeps every smoke check that
 * finds a button by its name working, which is not the reason but is a fair
 * test of whether the label was load-bearing.
 *
 * Progressive enhancement is intact: with no JavaScript this renders a plain
 * submit button that posts the form, exactly as before.
 */
export function SubmitButton({
  children,
  icon,
  className = '',
  disabled,
  ...rest
}: {
  children: React.ReactNode;
  /** Swapped for the spinner while pending. Omit for a text-only button. */
  icon?: string;
  className?: string;
  disabled?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'disabled'>) {
  const { pending } = useFormStatus();

  return (
    <button
      {...rest}
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={className}
    >
      {icon && (
        <span className={pending ? 'spin' : undefined} style={{ display: 'inline-flex' }}>
          <Icon name={pending ? 'spinner' : icon} size={13} />
        </span>
      )}
      {children}
    </button>
  );
}
