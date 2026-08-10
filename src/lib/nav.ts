/**
 * The navigation entries, as data.
 *
 * These lived in `SidebarNav.tsx` until `/more` needed them. That did not
 * work, and the reason is worth writing down because it is invisible until it
 * throws: `SidebarNav.tsx` is a `'use client'` module, and a Server Component
 * importing *anything* from one gets a client reference — a proxy the bundler
 * substitutes so the value can be sent across the boundary. That is exactly
 * right for a component and useless for an array. `ADMIN.filter is not a
 * function` is what it looks like, at runtime, on the page rather than in the
 * build.
 *
 * So the data lives here, in a module with no directive, and both sides import
 * it: the rail (client) and `/more` (server). `SidebarNav` still re-exports all
 * three, so nothing that already imported them from there has to change.
 *
 * One list, two arrangements. The rail enumerates the nine smart lists because
 * it has the height; `/more` folds them behind a single Tasks row and splits
 * `ADMIN` into Automation and System. Those are different groupings of these
 * same entries — which is the point of them being here rather than typed out
 * twice and drifting.
 */

export type NavEntry = { href: string; icon: string; label: string };

/** The surfaces you reach for. */
export const PRIMARY: readonly NavEntry[] = [
  { href: '/', icon: 'check', label: 'Today' },
  { href: '/calendar/week', icon: 'calendar', label: 'Calendar' },
  { href: '/capture', icon: 'plus', label: 'Capture' },
  { href: '/search', icon: 'search', label: 'Search' },
  { href: '/people', icon: 'users', label: 'People' },
];

/** Yours, but not opened ten times a day. */
export const SECONDARY: readonly NavEntry[] = [
  { href: '/places', icon: 'map_pin', label: 'Places' },
  { href: '/travel', icon: 'route', label: 'Travel' },
  { href: '/notes', icon: 'note', label: 'Notes' },
];

/** Administration. Below the fold, rather than beside Today at equal weight. */
export const ADMIN: readonly NavEntry[] = [
  { href: '/rules', icon: 'route', label: 'Rules' },
  { href: '/ai', icon: 'sparkle', label: 'AI' },
  { href: '/sync', icon: 'undo', label: 'Sync' },
  { href: '/settings', icon: 'settings', label: 'Settings' },
];
