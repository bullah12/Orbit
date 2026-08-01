import type { MetadataRoute } from 'next';

/**
 * Enough of a manifest to install Orbit on a home screen, and no more.
 *
 * `display: standalone` is the point of the file: a household organiser is
 * opened from a lock screen while somebody is holding a phone in one hand, and
 * a browser's address bar is 60px of that screen spent on a URL nobody reads.
 *
 * No icons are declared. An icon here that does not exist is a broken image on
 * somebody's home screen, which is worse than the letter the platform draws
 * for itself — and there is no artwork in this repository to point at.
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
  };
}
