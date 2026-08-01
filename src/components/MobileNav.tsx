'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Icon } from './Icon';
import { isActive } from './NavLink';
import { PRIMARY } from './SidebarNav';

/**
 * Navigation on a narrow screen.
 *
 * The rail is 240px, which is 62% of a 390px phone — so below `md` it is not
 * shown at all and this takes over: a bar along the bottom for the five
 * surfaces somebody actually opens, and a drawer holding the whole of the rail
 * for everything else.
 *
 * Along the bottom rather than the top because that is where a thumb is. The
 * bar sits above the home indicator via `env(safe-area-inset-bottom)`, and
 * `<main>` carries matching padding so the last row of a list is never parked
 * underneath it.
 *
 * The drawer closes on navigation, on Escape and on the backdrop — all three,
 * because it covers the page and a cover with one exit is a trap.
 */
export function MobileNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const spaceParam = useSearchParams().get('space');

  // Escape closes it, and while it is open the page beneath does not scroll —
  // otherwise a flick meant for the drawer moves the list behind it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close the menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full"
            style={{ background: 'color-mix(in oklab, var(--bg-sunken) 72%, transparent)' }}
          />
          <nav
            aria-label="All of Orbit"
            className="hairline absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-5 overflow-y-auto border-r px-3 py-4"
            style={{ background: 'var(--bg-sunken)' }}
          >
            {children}
          </nav>
        </div>
      )}

      <nav
        aria-label="Primary"
        className="hairline fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t md:hidden"
        style={{
          background: 'var(--bg-raised)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {PRIMARY.map((l) => (
          <TabLink
            key={l.href}
            {...l}
            active={isActive(l.href, pathname, spaceParam)}
            onClick={() => setOpen(false)}
          />
        ))}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="More of Orbit"
          className="tab flex flex-col items-center justify-center gap-0.5 py-1.5"
        >
          <Icon name={open ? 'x' : 'move'} size={17} className="muted" />
          <span className="faint text-2xs">More</span>
        </button>
      </nav>
    </>
  );
}

function TabLink({
  href,
  icon,
  label,
  active,
  onClick,
}: {
  href: string;
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Link
      href={href as never}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className="tab flex flex-col items-center justify-center gap-0.5 py-1.5"
    >
      <Icon name={icon} size={17} className={active ? undefined : 'muted'} />
      <span className={active ? 'text-2xs font-semibold' : 'faint text-2xs'}>{label}</span>
    </Link>
  );
}
