import type { NextConfig } from 'next';

const config: NextConfig = {
  // Typed routes catch a link to a page that does not exist at build time.
  // Note: `pnpm typecheck` needs a `pnpm build` first on a fresh clone, because
  // the route types are generated into .next/types.
  typedRoutes: true,

  // A self-contained server in .next/standalone, which is what the Dockerfile
  // copies. Orbit needs a long-lived process rather than a serverless function:
  // every page is `force-dynamic` and src/lib/db/index.ts holds a connection
  // pool, which is an asset in a container and a liability in a lambda.
  //
  // `pnpm start` still works locally — this adds an output directory, it does
  // not take the ordinary server away, and `pnpm smoke` still drives it.
  output: 'standalone',
};

export default config;
