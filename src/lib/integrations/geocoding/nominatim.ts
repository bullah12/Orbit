/**
 * REAL IMPLEMENTATION — WRITTEN, NEVER RUN.
 *
 * OpenStreetMap Nominatim, written from the published API documentation and the
 * usage policy. There is no outbound network in the environment Orbit is built
 * in, so not one line of this has been executed. Do not describe it as working,
 * and do not let `FakeGeocodingProvider` stand in for it in a claim that it
 * does.
 *
 * Selected with GEOCODING_PROVIDER=nominatim.
 *
 * Nominatim has no API key, but its usage policy requires a genuine
 * identifying contact in the User-Agent and treats an anonymous client as
 * abuse. That contact is therefore a *credential* here in every sense that
 * matters: NOMINATIM_CONTACT is required, and its absence fails when this
 * provider is **called**, not when it is constructed — the app has to boot and
 * render with zero credentials whatever the env says.
 *
 * Two other things the policy requires and this encodes:
 *  - at most one request a second, so requests are serialised behind a
 *    small gate rather than fired in parallel;
 *  - a bounded result set and an explicit language, so the label a user sees
 *    does not depend on the server's guess about them.
 */

import { IntegrationError, type GeocodeResult, type GeocodingProvider } from '../types';

const API = 'https://nominatim.openstreetmap.org';
const MIN_INTERVAL_MS = 1_000;

type NominatimPlace = {
  lat: string;
  lon: string;
  display_name: string;
  importance?: number;
};

export class NominatimGeocodingProvider implements GeocodingProvider {
  readonly name = 'geocoding:nominatim';
  readonly isFake = false;

  private lastRequestAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly env: Record<string, string | undefined> = process.env as Record<
      string,
      string | undefined
    >,
    private readonly timeoutMs = 10_000,
  ) {}

  /**
   * The contact string. Not optional: an unidentified client is what the usage
   * policy calls abuse, and getting Orbit's users blocked by pretending
   * otherwise is worse than refusing.
   */
  private contact(): string {
    const contact = this.env.NOMINATIM_CONTACT;
    if (!contact) {
      throw new IntegrationError(
        'geocoding:nominatim',
        'missing_credential',
        'set NOMINATIM_CONTACT to an email address or URL the operator can reach you at, ' +
          'as the Nominatim usage policy requires, or leave GEOCODING_PROVIDER=fake',
      );
    }
    return contact;
  }

  /** One request a second, in order. The policy is a rate limit, not a suggestion. */
  private schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.lastRequestAt + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRequestAt = Date.now();
      return fn();
    });
    // Keep the chain alive even when one call rejects.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async request<T>(path: string, params: Record<string, string>): Promise<T> {
    const contact = this.contact();
    const url = new URL(`${API}${path}`);
    for (const [k, v] of Object.entries({ ...params, format: 'jsonv2' })) {
      url.searchParams.set(k, v);
    }

    return this.schedule(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            // The policy asks for an application name and a way to be reached.
            'user-agent': `Orbit/0.1 (${contact})`,
            'accept-language': 'en-GB',
            accept: 'application/json',
          },
        });
        if (res.status === 429 || res.status === 403) {
          throw new IntegrationError(
            'geocoding:nominatim',
            'transport',
            `rate limited or blocked (${res.status}) — check NOMINATIM_CONTACT and slow down`,
          );
        }
        if (!res.ok) {
          throw new IntegrationError(
            'geocoding:nominatim',
            'transport',
            `${res.status} ${res.statusText}`,
          );
        }
        return (await res.json()) as T;
      } catch (err) {
        if (err instanceof IntegrationError) throw err;
        throw new IntegrationError('geocoding:nominatim', 'transport', String(err));
      } finally {
        clearTimeout(timer);
      }
    });
  }

  async geocode(query: string): Promise<GeocodeResult[]> {
    const q = query.trim();
    if (!q) return [];
    const rows = await this.request<NominatimPlace[]>('/search', {
      q,
      limit: '5',
      addressdetails: '0',
    });
    return rows.map(toResult).filter((r): r is GeocodeResult => r !== null);
  }

  async reverse(lat: number, lon: number): Promise<GeocodeResult | null> {
    const row = await this.request<NominatimPlace & { error?: string }>('/reverse', {
      lat: String(lat),
      lon: String(lon),
      zoom: '18',
    });
    if (!row || row.error) return null;
    return toResult(row);
  }
}

/**
 * Nominatim returns coordinates as strings and an `importance` between 0 and 1
 * that is not a confidence. It is the only ranking signal on offer, so it is
 * carried across as one and clamped; a row without it is reported as unsure
 * rather than as certain.
 */
function toResult(row: NominatimPlace): GeocodeResult | null {
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const importance = typeof row.importance === 'number' ? row.importance : 0.3;
  return {
    label: row.display_name,
    lat,
    lon,
    confidence: Math.max(0, Math.min(1, importance)),
  };
}
