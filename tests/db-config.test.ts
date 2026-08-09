import { describe, expect, it } from 'vitest';
import { DEFAULT_POOL_MAX, poolMax } from '@/lib/db/config';

/**
 * How many connections one process may hold.
 *
 * The failure this guards against is not a crash — it is a quiet one. A pool
 * size that silently became `NaN` is accepted by `postgres` and then behaves
 * unpredictably under load, which is exactly when nobody is reading logs.
 */
describe('the connection pool size', () => {
  it('defaults to a container-shaped pool', () => {
    expect(poolMax(undefined)).toBe(DEFAULT_POOL_MAX);
    expect(poolMax('')).toBe(DEFAULT_POOL_MAX);
    expect(poolMax('   ')).toBe(DEFAULT_POOL_MAX);
  });

  it('takes the serverless setting', () => {
    // Vercel: one process per concurrent request, so pooling belongs to
    // Supabase's transaction pooler rather than to this app.
    expect(poolMax('1')).toBe(1);
    expect(poolMax('20')).toBe(20);
  });

  it('refuses anything that is not a usable count', () => {
    for (const junk of ['nonsense', '0', '-1', '2.5', 'Infinity', 'NaN', '1e3.5', '1,000']) {
      expect(poolMax(junk), junk).toBe(DEFAULT_POOL_MAX);
    }
  });
});
