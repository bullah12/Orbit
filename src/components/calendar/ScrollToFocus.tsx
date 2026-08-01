'use client';

import { useEffect, useRef } from 'react';

/**
 * Puts the interesting part of the day at the top of the grid.
 *
 * The calendar is 24 hours tall and opens at 00:00, so seven empty night hours
 * used to occupy the viewport before the first real event — on a phone that was
 * the entire screen. Every other calendar scrolls to now on open; this is that.
 *
 * `fraction` is computed on the server (now, if today is one of the days shown;
 * otherwise the first event; otherwise the start of the working day), so this
 * component decides nothing — it only moves a scroll position, which is the one
 * thing a server cannot do.
 *
 * A quarter of the viewport is left above the mark so the hour before it stays
 * visible: arriving at 14:05 you almost always want to see what 13:30 was.
 * `behavior: 'auto'` because this is where the page starts, not a movement —
 * animating it would be motion nobody asked for, on first paint.
 */
export function ScrollToFocus({ fraction, gridHeight }: { fraction: number; gridHeight: number }) {
  const marker = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroller = marker.current?.closest('[data-calendar-scroll]');
    if (!(scroller instanceof HTMLElement)) return;

    const target = fraction * gridHeight - scroller.clientHeight / 4;
    scroller.scrollTo({ top: Math.max(0, target), behavior: 'auto' });
    // Only on arrival. Re-running it would yank the grid back while somebody is
    // reading the evening.
  }, [fraction, gridHeight]);

  return <div ref={marker} aria-hidden="true" />;
}
