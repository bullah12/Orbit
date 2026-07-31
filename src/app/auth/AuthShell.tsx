import Link from 'next/link';
import { Icon } from '@/components/Icon';

/**
 * The frame every auth screen sits in.
 *
 * Nothing here invents a colour: the surface, the hairline and the three text
 * weights are the same tokens every other page uses, and `tests/contrast.test.ts`
 * measures them. A sign-in page is the first thing somebody sees, which is a
 * reason to make it plain rather than a reason to make it special.
 */
export function AuthShell({
  title,
  lead,
  children,
  footer,
}: {
  title: string;
  lead: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-5">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Orbit
        </Link>
        <h1 className="mt-3 text-xl font-semibold">{title}</h1>
        <p className="muted mt-1 text-xs">{lead}</p>
      </div>
      <div className="surface p-4">{children}</div>
      {footer && <div className="muted mt-3 text-xs">{footer}</div>}
    </div>
  );
}

/** A refusal or a confirmation, in a sentence. Never a status code. */
export function Notice({
  tone,
  children,
}: {
  tone: 'warning' | 'success';
  children: React.ReactNode;
}) {
  const colour = tone === 'warning' ? 'var(--warning)' : 'var(--success)';
  const background = tone === 'warning' ? 'var(--warning-bg)' : 'var(--success-bg)';
  return (
    <p
      role={tone === 'warning' ? 'alert' : 'status'}
      className="mb-3 flex items-start gap-2 rounded px-3 py-2 text-xs"
      style={{ background, color: colour }}
    >
      <Icon name={tone === 'warning' ? 'alert' : 'check'} size={12} />
      <span>{children}</span>
    </p>
  );
}

export function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  autoComplete,
  required,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  autoComplete?: string;
  required?: boolean;
  hint?: string;
}) {
  const id = `field-${name}`;
  return (
    <div className="mb-3">
      <label htmlFor={id} className="section-label mb-1 block">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        className="input"
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        required={required}
      />
      {hint && <p className="faint mt-1 text-2xs">{hint}</p>}
    </div>
  );
}

export function SubmitButton({
  children,
  formAction,
  quiet,
}: {
  children: React.ReactNode;
  formAction?: (formData: FormData) => void | Promise<void>;
  quiet?: boolean;
}) {
  return (
    <button
      type="submit"
      formAction={formAction}
      className="hairline w-full rounded border px-3 py-1.5 text-sm font-medium"
      style={
        quiet
          ? { background: 'var(--bg-raised)' }
          : { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'transparent' }
      }
    >
      {children}
    </button>
  );
}
