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
