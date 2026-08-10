/**
 * A small inline icon set. No icon library: every category chip and space
 * indicator needs an icon to be legible, so icons are load-bearing and must not
 * depend on a font or a CDN.
 */

const PATHS: Record<string, string> = {
  house: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5M9.5 20v-6h5v6',
  receipt: 'M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5V3ZM9 8h6M9 12h6',
  heart: 'M12 20s-7-4.4-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.6-7 9-7 9Z',
  users: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 20v-1.5A4.5 4.5 0 0 1 7 14h2a4.5 4.5 0 0 1 4.5 4.5V20M16 5.5a3 3 0 0 1 0 6M17 14a4.5 4.5 0 0 1 4.5 4.5V20',
  briefcase: 'M3 8h18v12H3V8ZM9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8M3 13h18',
  sprout: 'M12 21v-7M12 14c0-3 2-5 5-5 0 3-2 5-5 5ZM12 14c0-3-2-5-5-5 0 3 2 5 5 5Z',
  car: 'M4 16v3h3v-3M17 16v3h3v-3M3 16h18v-4l-2-5H5l-2 5v4ZM6.5 12.5h2M15.5 12.5h2',
  glass: 'M8 3h8l-1 5a3 3 0 0 1-6 0L8 3ZM12 13v7M9 20h6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20.5v-1A5.5 5.5 0 0 1 10 14h4a5.5 5.5 0 0 1 5.5 5.5v1',
  circle: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z',
  calendar: 'M4 6h16v14H4V6ZM8 3v4M16 3v4M4 10h16',
  check: 'M4.5 12.5 9.5 17.5 19.5 6.5',
  note: 'M6 3h9l4 4v14H6V3ZM14 3v5h5M9 12h6M9 16h4',
  inbox: 'M4 13h4l1.5 3h5L16 13h4M4 13 6.5 5h11L20 13v6H4v-6Z',
  clock: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 7.5V12l3 2',
  pause: 'M9.5 5v14M14.5 5v14',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z',
  lock: 'M6 11h12v9H6v-9ZM8.5 11V8a3.5 3.5 0 1 1 7 0v3',
  eye_off: 'M4 4l16 16M10 6.2A7.6 7.6 0 0 1 12 6c5 0 8 6 8 6a15 15 0 0 1-2.4 3.2M6.4 8.8A15 15 0 0 0 4 12s3 6 8 6a7.7 7.7 0 0 0 2.9-.6',
  arrow_right: 'M5 12h14M13 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  move: 'M12 3v18M3 12h18M12 3 9 6M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  alert: 'M12 4 2.5 20h19L12 4ZM12 10v4.5M12 17.2v.1',
  link: 'M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.3 1.3M14 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.3-1.3',
  archive: 'M3 4h18v4H3V4ZM5 8v12h14V8M9.5 12h5',
  trash: 'M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 10.5v6M14 10.5v6',
  x: 'M6 6l12 12M18 6 6 18',
  undo: 'M4 9h11a5 5 0 0 1 0 10h-5M4 9l4-4M4 9l4 4',
  // Three quarters of a circle. Whole, it would not read as turning.
  spinner: 'M12 4a8 8 0 1 1-5.66 2.34',
  cake: 'M4 20h16v-6H4v6ZM4 14a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2M12 12V8M12 5.5v.1M8 12V9M16 12V9',
  phone: 'M6 3h3l1.5 4-2 1.5a12 12 0 0 0 6 6L16 12.5 20 14v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.2 2 2 0 0 1 6 3Z',
  mail: 'M3 6h18v12H3V6ZM3 7l9 6 9-6',
  pin: 'M12 21v-6M8 4h8l-1 5 2.5 2.5h-11L9 9 8 4Z',
  map_pin: 'M12 21s6.5-6.1 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 14.9 12 21 12 21ZM12 13a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  route: 'M6.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM17.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM15 6.5H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H9',
  walk: 'M13 4.5v.1M12 21l1.5-5.5L11 13l.5-4L9 11l-1.5 3M13.5 9.5 16 11l2 .5M11.5 9 9 21',
  bike: 'M6 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 16l4-8h5l3 8M9.5 8h4M15 5h2.5',
  bus: 'M5 4h14v12H5V4ZM5 16v3h3v-3M16 16v3h3v-3M5 11h14M8.5 19h7',
  train: 'M7 3h10v12H7V3ZM7 9h10M9.5 12.5h.1M14.5 12.5h.1M9 15l-2.5 5M15 15l2.5 5',
  plane: 'M3 13.5 21 4l-4 17-4.5-6.5L6 12.5l6.5 2Z',
  suitcase: 'M3 8h18v12H3V8ZM8 8V4.5h8V8M8 20v-8M16 20v-8',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM16 16l4.5 4.5',
  sparkle: 'M12 3.5 13.8 9l5.5 1.8-5.5 1.8L12 18l-1.8-5.4L4.7 10.8 10.2 9 12 3.5ZM18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z',
  wand: 'M4 20 15 9M15 9l-2-2 3-3 2 2-3 3ZM19 4.5v.1M21.5 9v.1M9 4v.1M6 7.5v.1',
  slash: 'M17 4 7 20',
  // Points at the destination on a settings row. Drawn at the same 24px scale
  // as everything else and rendered small, rather than as its own 16px glyph.
  chevron: 'M9.5 5.5 16 12l-6.5 6.5',
  // Three dots, in the same zero-length-segment idiom `alert` uses for its
  // full stop. `move` used to be the More tab and reads as a drag handle.
  dots: 'M6 12v.1M12 12v.1M18 12v.1',
  // A gear, drawn as a ring of eight teeth plus a hub, in the same 24px box and
  // single-stroke idiom as the rest. Settings is the one nav entry that had no
  // icon to borrow: reusing `circle` would have made it indistinguishable from
  // a space chip in the drawer, and every nav link carries an icon.
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3'
    + 'M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3',
};

export type IconName = keyof typeof PATHS | string;

export function Icon({
  name,
  size = 14,
  className,
  strokeWidth = 1.75,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  const d = PATHS[name] ?? PATHS.circle!;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
