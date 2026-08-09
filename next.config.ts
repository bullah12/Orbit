import type { NextConfig } from 'next';

const config: NextConfig = {
  // Typed routes catch a link to a page that does not exist at build time.
  // Note: `pnpm typecheck` needs a `pnpm build` first on a fresh clone, because
  // the route types are generated into .next/types.
  typedRoutes: true,

  // A self-contained server in .next/standalone, which is what the Dockerfile
  // copies — and which Vercel neither needs nor wants, since it builds its own
  // output. Set everywhere except there.
  //
  // The pool is what used to make this an either/or. A pool is an asset in a
  // process that outlives the request and a liability in one that does not, so
  // the original note here said "not serverless". That holds only while the app
  // pools for itself: against Supabase's *transaction* pooler with
  // `DATABASE_POOL_MAX=1` and `DATABASE_PREPARE=false`, the pooling happens in
  // Supavisor and serverless is a perfectly good fit — a better one, for an app
  // somebody opens a few times a day and would rather not pay to keep warm.
  //
  // `pnpm start` still works locally either way: this adds an output directory,
  // it does not take the ordinary server away, and `pnpm smoke` still drives it.
  output: process.env.VERCEL ? undefined : 'standalone',
};

export default config;
