import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * The TypeScript suite covers what pgTAP cannot reach: pure logic that runs in
 * the app rather than in the database. RLS is tested in pgTAP and nowhere else,
 * because a TypeScript test of RLS would be testing the client's opinion of the
 * policy rather than the policy.
 *
 * TZ is pinned to Europe/London so that a date test failing here means the code
 * is wrong, not that the container's clock is.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    env: { TZ: 'Europe/London' },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws on import unless the resolver is asked for React's
      // `react-server` condition, which Vitest has no reason to ask for. Without
      // this alias `src/lib/auth/supabase.ts` cannot be imported by a test at
      // all — which is most of why the provider's HTTP layer went four sessions
      // without a single line of it executing. The marker still does its real
      // job: it is the *bundler* that must refuse a client import, and the
      // bundler resolves this package for itself.
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
    },
  },
});
