'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ACTIONS, GO_TO, hasModifier, isTyping, resolve } from '@/lib/shortcuts';

/**
 * The one listener that makes the app keyboard-driven.
 *
 * Three rules, all of them in `src/lib/shortcuts.ts` so they can be tested
 * without a browser:
 *
 *   1. Never take a key from somebody who is typing.
 *   2. Never take a key from the browser — anything with ⌘, Ctrl or Alt.
 *   3. Never be the only way to do anything. Every shortcut here duplicates a
 *      link that is still on the screen; this is a faster route, not a hidden
 *      one, and `?` lists the lot.
 *
 * `g` is a prefix rather than a chord because a household organiser is used
 * one-handed as often as not, and it forgets itself after a second so a stray
 * g does not silently arm the next keystroke.
 */
export function Shortcuts() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPending = useCallback(() => {
    pending.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        clearPending();
        setHelpOpen(false);
        return;
      }

      if (hasModifier(e) || isTyping(document.activeElement)) return;

      const outcome = resolve(e.key, pending.current);

      if (outcome.kind === 'pending') {
        e.preventDefault();
        pending.current = 'g';
        // A prefix that waits for ever means a g typed by accident changes what
        // the next keystroke does, minutes later.
        timer.current = setTimeout(clearPending, 1200);
        return;
      }

      clearPending();

      if (outcome.kind === 'go') {
        e.preventDefault();
        setHelpOpen(false);
        router.push(outcome.href as never);
      } else if (outcome.kind === 'help') {
        e.preventDefault();
        setHelpOpen((v) => !v);
      }
    }

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router, clearPending]);

  if (!helpOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'color-mix(in oklab, var(--bg-sunken) 72%, transparent)' }}
    >
      <button
        type="button"
        aria-label="Close the keyboard shortcuts"
        onClick={() => setHelpOpen(false)}
        className="absolute inset-0 h-full w-full"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="surface relative max-h-full w-full max-w-md overflow-y-auto p-4"
      >
        <h2 className="mb-3 text-lg font-semibold">Keyboard shortcuts</h2>

        <Group title="Go to" shortcuts={GO_TO} />
        <Group title="Do" shortcuts={ACTIONS} />

        <p className="faint mt-3 text-2xs">
          None of these is the only way to do anything, and none of them fires
          while you are typing.
        </p>
      </div>
    </div>
  );
}

function Group({
  title,
  shortcuts,
}: {
  title: string;
  shortcuts: { keys: string; label: string }[];
}) {
  return (
    <section className="mb-3">
      <h3 className="section-label mb-1">{title}</h3>
      <ul>
        {shortcuts.map((s) => (
          <li key={s.keys} className="row justify-between text-sm">
            <span>{s.label}</span>
            <span className="flex gap-1">
              {s.keys.split(' ').map((k, i) => (
                <kbd
                  key={`${k}-${i}`}
                  className="hairline rounded border px-1.5 py-0.5 text-2xs"
                  style={{ background: 'var(--bg-sunken)', fontFamily: 'var(--font-mono)' }}
                >
                  {k}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
