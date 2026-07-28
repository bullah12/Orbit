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
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
