import type { SpaceRef } from '@/components/SpaceIndicator';

/**
 * What the map needs to know about a person.
 *
 * Its own module so that `PeopleMap` can name the type without importing
 * `MapCanvas` — which would pull MapLibre into the bundle at build time and
 * quietly undo the whole point of loading it dynamically. A type-only import
 * would be erased, but "this import is safe because it is type-only" is a
 * property one careless edit destroys, and the failure is invisible: the page
 * still works, it is just 220 KB heavier.
 */
export type MapPerson = {
  id: string;
  displayName: string;
  /** Tints the avatar and the pin from the same ramp the list uses. */
  category: { name: string; colour: string; icon: string } | null;
  /** The sheet carries a space indicator like every other surface. */
  space: SpaceRef;
  /** One line of secondary detail — the same sentence the list row shows. */
  detail: string | null;
  placeName: string;
  placeAddress: string | null;
  lat: number;
  lon: number;
};
