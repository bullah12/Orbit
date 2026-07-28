import type { TravelEstimate, TravelMode, TravelTimeProvider } from '../types';

/** Straight-line metres between two WGS84 points. */
export function haversineMetres(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * Average speeds, and a detour factor because roads are not straight lines.
 * Deliberately crude: the point of the fake is to be deterministic and never to
 * need a credential, not to be right.
 */
const KMH: Record<TravelMode, number> = { walk: 4.8, cycle: 15, drive: 28, transit: 18 };
const DETOUR = 1.3;

export class FakeTravelTimeProvider implements TravelTimeProvider {
  readonly name = 'travel:fake';
  readonly isFake = true;

  async estimate(
    from: { lat: number; lon: number },
    to: { lat: number; lon: number },
    mode: TravelMode,
  ): Promise<TravelEstimate> {
    const metres = Math.round(haversineMetres(from, to) * DETOUR);
    const minutes = Math.max(1, Math.round((metres / 1000 / KMH[mode]) * 60));
    return { mode, minutes, metres, isEstimate: true };
  }
}
