/**
 * REAL IMPLEMENTATION — WRITTEN, NEVER RUN.
 *
 * There is no outbound network in the environment Orbit is developed in, so
 * this file has never been executed against a live feed. It is written against
 * RFC 5545 and ordinary HTTP semantics, and the parsing it delegates to *is*
 * covered by tests — but do not describe this class as working until somebody
 * has pointed it at a real URL.
 *
 * Selected with ICS_PROVIDER=http.
 */

import { IntegrationError, type IcsProvider, type IcsSource } from '../types';

const MAX_BYTES = 8 * 1024 * 1024;

export class HttpIcsProvider implements IcsProvider {
  readonly name = 'ics:http';
  readonly isFake = false;

  constructor(private readonly timeoutMs = 15_000) {}

  async fetchText(source: IcsSource): Promise<string> {
    let url: URL;
    try {
      url = new URL(source.ref.replace(/^webcal:/i, 'https:'));
    } catch {
      throw new IntegrationError('ics:http', 'not_found', `not a URL: ${source.ref}`);
    }
    // A subscription URL is user-supplied, so the scheme is checked rather than
    // assumed: file: and data: would otherwise read the server's own disk.
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new IntegrationError('ics:http', 'not_found', `refusing scheme ${url.protocol}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { accept: 'text/calendar, text/plain;q=0.8, */*;q=0.1' },
      });
      if (!res.ok) {
        throw new IntegrationError('ics:http', 'transport', `${res.status} ${res.statusText}`);
      }
      const text = await res.text();
      if (text.length > MAX_BYTES) {
        throw new IntegrationError('ics:http', 'malformed', `feed exceeds ${MAX_BYTES} bytes`);
      }
      return text;
    } catch (err) {
      if (err instanceof IntegrationError) throw err;
      throw new IntegrationError('ics:http', 'transport', String(err));
    } finally {
      clearTimeout(timer);
    }
  }
}
