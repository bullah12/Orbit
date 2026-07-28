import type { NextConfig } from 'next';

const config: NextConfig = {
  // Typed routes catch a link to a page that does not exist at build time.
  // Note: `pnpm typecheck` needs a `pnpm build` first on a fresh clone, because
  // the route types are generated into .next/types.
  typedRoutes: true,
};

export default config;
