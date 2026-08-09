import type { MetadataRoute } from 'next';

/**
 * Enough of a manifest to install Orbit on a home screen, and no more.
 *
 * `display: standalone` is the point of the file: a household organiser is
 * opened from a lock screen while somebody is holding a phone in one hand, and
 * a browser's address bar is 60px of that screen spent on a URL nobody reads.
 *
 * The icons are committed PNGs, not build output. An icon here that does not
 * exist is a broken image on somebody's home screen, so the rasterised files
 * are in git rather than produced by `pnpm icons` — an environment that skips
 * the script must still serve them. `scripts/icons.mjs` regenerates them from
 * the SVG sources in `public/icons/src`.
 *
 * `any` and `maskable` are separate entries on purpose. A single entry marked
 * `purpose: 'any maskable'` makes iOS and desktop draw the padded safe-zone
 * artwork, so the mark shrinks ~28% everywhere to satisfy Android alone.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Orbit',
    short_name: 'Orbit',
    description: 'Tasks, notes, people and calendar, in spaces you control.',
    start_url: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f9fafb',
    theme_color: '#f9fafb',
    lang: 'en-GB',
    categories: ['productivity', 'lifestyle'],
    icons: [
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      {
        src: '/icons/monochrome-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'monochrome',
      },
    ],
  };
}
