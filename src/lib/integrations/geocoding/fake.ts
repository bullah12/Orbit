import type { GeocodeResult, GeocodingProvider } from '../types';

/**
 * The default geocoder. A table of Birmingham places, matched by substring.
 *
 * Phase 3 uses this; the real implementation (Nominatim) belongs to that phase
 * and has not been written yet, which is recorded in STATUS.md rather than
 * papered over with a class that throws.
 */
const PLACES: GeocodeResult[] = [
  { label: 'Kings Heath, Birmingham', lat: 52.4297, lon: -1.8931, confidence: 1 },
  { label: 'Stirchley Baths, Birmingham', lat: 52.4325, lon: -1.9143, confidence: 1 },
  { label: 'Council House, Victoria Square, Birmingham', lat: 52.4800, lon: -1.9030, confidence: 1 },
  { label: 'Moseley, Birmingham', lat: 52.4459, lon: -1.8869, confidence: 1 },
  { label: 'Selly Oak, Birmingham', lat: 52.4416, lon: -1.9382, confidence: 1 },
  { label: 'Bournville, Birmingham', lat: 52.4269, lon: -1.9345, confidence: 1 },
  { label: 'Digbeth, Birmingham', lat: 52.4757, lon: -1.8871, confidence: 1 },
  { label: 'Birmingham New Street station', lat: 52.4778, lon: -1.8996, confidence: 1 },
];

export class FakeGeocodingProvider implements GeocodingProvider {
  readonly name = 'geocoding:fake';
  readonly isFake = true;

  async geocode(query: string): Promise<GeocodeResult[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return PLACES.filter((p) => p.label.toLowerCase().includes(q)).map((p) => ({ ...p }));
  }

  async reverse(lat: number, lon: number): Promise<GeocodeResult | null> {
    let best: GeocodeResult | null = null;
    let bestD = Infinity;
    for (const p of PLACES) {
      const d = (p.lat - lat) ** 2 + (p.lon - lon) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best ? { ...best } : null;
  }
}
