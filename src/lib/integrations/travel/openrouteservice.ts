/**
 * REAL IMPLEMENTATION — WRITTEN, NEVER RUN.
 *
 * OpenRouteService directions, written from the published API reference. There
 * is no outbound network and no API key in the environment Orbit is built in,
 * so not one line of this has been executed. Do not describe it as working, and
 * do not let `FakeTravelTimeProvider` stand in for it in a claim that it does.
 *
 * Selected with TRAVEL_TIME_PROVIDER=openrouteservice. It needs
 * ORS_API_KEY; without it this throws when *called*, never at import.
 *
 * Two things it deliberately does not do:
 *  - it does not offer public transport. ORS has no transit profile, and
 *    silently answering a `transit` question with a driving number would be a
 *    lie with a plausible-looking number attached. It refuses instead, and
 *    `estimateLegMinutes()` in src/lib/travel.ts is what fills the gap.
 *  - it does not send anything but two coordinate pairs. No place name, no
 *    space, no event title — a routing request is not a reason to tell a third
 *    party what somebody is doing.
 */

import {
  IntegrationError,
  type TravelEstimate,
  type TravelMode,
  type TravelTimeProvider,
} from '../types';

const API = 'https://api.openrouteservice.org/v2/directions';

/** ORS profile names. `transit` has no profile and is refused rather than faked. */
const PROFILE: Record<TravelMode, string | null> = {
  walk: 'foot-walking',
  cycle: 'cycling-regular',
  drive: 'driving-car',
  transit: null,
};

type OrsResponse = {
  routes?: { summary?: { duration?: number; distance?: number } }[];
  error?: { message?: string };
};

export class OpenRouteServiceTravelTimeProvider implements TravelTimeProvider {
  readonly name = 'travel:openrouteservice';
  readonly isFake = false;

  constructor(
    private readonly env: Record<string, string | undefined> = process.env as Record<
      string,
      string | undefined
    >,
    private readonly timeoutMs = 10_000,
  ) {}

  private apiKey(): string {
    const key = this.env.ORS_API_KEY;
    if (!key) {
      throw new IntegrationError(
        'travel:openrouteservice',
        'missing_credential',
        'set ORS_API_KEY, or leave TRAVEL_TIME_PROVIDER=fake',
      );
    }
    return key;
  }

  async estimate(
    from: { lat: number; lon: number },
    to: { lat: number; lon: number },
    mode: TravelMode,
  ): Promise<TravelEstimate> {
    const key = this.apiKey();
    const profile = PROFILE[mode];
    if (!profile) {
      throw new IntegrationError(
        'travel:openrouteservice',
        'not_found',
        `no routing profile for ${mode} — OpenRouteService does not do public transport`,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${API}/${profile}`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          authorization: key,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        // ORS takes [lon, lat], in that order. Getting it the wrong way round
        // puts Birmingham in the Atlantic and still returns a route.
        body: JSON.stringify({
          coordinates: [
            [from.lon, from.lat],
            [to.lon, to.lat],
          ],
          units: 'm',
        }),
      });

      const body = (await res.json().catch(() => ({}))) as OrsResponse;
      if (!res.ok) {
        throw new IntegrationError(
          'travel:openrouteservice',
          res.status === 401 || res.status === 403 ? 'missing_credential' : 'transport',
          body.error?.message ?? `${res.status} ${res.statusText}`,
        );
      }

      const summary = body.routes?.[0]?.summary;
      if (!summary || typeof summary.duration !== 'number') {
        throw new IntegrationError(
          'travel:openrouteservice',
          'not_found',
          'no route between those two points',
        );
      }

      return {
        mode,
        minutes: Math.max(1, Math.round(summary.duration / 60)),
        metres: Math.round(summary.distance ?? 0),
        // A routing engine's answer, not a table of averages.
        isEstimate: false,
      };
    } catch (err) {
      if (err instanceof IntegrationError) throw err;
      throw new IntegrationError('travel:openrouteservice', 'transport', String(err));
    } finally {
      clearTimeout(timer);
    }
  }
}
