# Working in this repository

## Checking your work: smoke, and only smoke

**`pnpm smoke` is the check to run on a change. Do not run the other suites
unless asked.**

Orbit has five commands and they used to all be run on every change. That is
several minutes of waiting for `pnpm test` to re-prove 828 pure functions
nobody touched. The smoke suite is the one that drives the real app through a
real browser against a real database, which is the only one that can tell you
whether the thing you changed works, so it is the one that runs.

So, after making a change:

```sh
pnpm build                     # smoke reads the built app; skipping this checks the old one
pnpm start                     # if it is not already up
pnpm smoke
```

`pnpm build` is not optional. `pnpm start` serves `.next`, so a smoke run
against a stale build is a green pass for code that is not the code you wrote —
the most expensive way to be wrong available here. Restart the server after
every build.

`pnpm build` also type-checks, so a separate `pnpm typecheck` is redundant on a
change that builds.

### Re-running: only what failed

**Never re-run the whole suite to check a fix. Re-run the sections that
failed.**

```sh
pnpm smoke --failed            # only the sections that failed last time
pnpm smoke --section=capture   # a named section, substring-matched
```

Every block in `scripts/smoke.mjs` belongs to a named section, and each run
writes its verdict to `.smoke-last.json` (not committed). `--failed` reads that
file and runs only the sections with failures in it — plus any section they
depend on, which `PREREQS` in that file declares.

A filtered run keeps the previous verdict for the sections it skipped, so
fixing one failure never marks the others as passing, and it never prints "all
checks passed" — it says how many sections it skipped. **A filtered pass is not
a green suite.** Run `pnpm smoke` in full once, at the end, before saying the
work is done.

### What this rule costs, chosen deliberately

Smoke drives the app, so it cannot see what the app never asks for. Two things
are therefore not covered by the rule above, and that is a known, accepted
trade:

- **Policies and definer functions.** Smoke checks what one signed-in person
  sees. `./scripts/db-test.sh` is what proves the database refuses everybody
  else.
- **Pure modules in `src/lib/`.** Parsing, recurrence, formatting and colour
  have no surface in the browser; `pnpm test` is where they are proved.

Run either of those only if the person you are working for asks. This section
exists so that nobody later mistakes their absence for an oversight.

## Everything else

`docs/STATUS.md` is the handoff contract and takes precedence over assumptions
about what is done. `docs/decisions-log.md` records why things are the way they
are, per session; add to it rather than rewriting it. `docs/runbook.md` is how
to get the database up.
