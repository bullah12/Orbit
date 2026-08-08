# Database tests

pgTAP, run against the real database by `./scripts/db-test.sh`.

```sh
./scripts/db-reset.sh      # rebuild + seed
./scripts/db-test.sh       # run everything
./scripts/db-test.sh rls   # run tests whose filename contains "rls"
```

## What is tested here, and what is not

These tests exist to prove one thing: **the database, not the client, decides
what a user can see.** Every assertion runs as the `authenticated` role — the
same role the application connects as — so a policy that only appears to work
because the app happened to add a `where` clause will fail here.

Anything that can be checked with a unit test in TypeScript should be. This file
is for the things that can only be checked in Postgres.

## Conventions

- **Each file is one transaction, rolled back at the end.** Tests never leave
  residue, so they can run against a seeded database.
- **Fixtures are built as the table owner**, before the first `act_as`, because
  RLS does not apply to the owner. That is the only place the tests get to
  cheat.
- **`tests.act_as(uuid)`** switches the acting user. It sets
  `request.jwt.claims` and `set local role authenticated` — exactly what happens
  between two HTTP requests in production. `tests.as_owner()` switches back for
  setup or for asserting on rows the acting user cannot see.
- **The plan count is fixed**, not `no_plan()`. If you add an assertion, update
  `select plan(N)`. `db-test.sh` fails the run on a plan mismatch, not just on a
  failing assertion — a silently skipped test is the failure mode a plan exists
  to catch.

## The cast

| Who     | Role                                   | Exists to prove                          |
|---------|----------------------------------------|------------------------------------------|
| Alice   | owner of `Alice` and `Home`            | the power user's own view                |
| Bob     | member of `Home`, owner of `Bob`       | the partner sees shared, not private     |
| Carol   | `free_busy` participant of `Home`      | availability without content             |
| Mallory | member of nothing                      | the outsider sees nothing, ever          |

Mallory is the important one. Every new entity type should get a "Mallory sees
zero" assertion, because that is the check that catches a table shipped without
a policy.

## When you add a table

1. Add it to a migration with `space_id`, `owner_id`, and
   `select orbit.apply_standard_rls('your_table')`.
2. Add an isolation case here: Alice can see her row, Bob's visibility is what
   you intended, Mallory sees nothing.
3. Bump `select plan(N)`.

The structural assertions at the end of `rls_isolation_test.sql` will already
fail if the new table is missing `space_id`/`owner_id`, has no policy, or has a
unique constraint that does not lead with `space_id`. They cannot tell you
whether your policy expresses what you meant — only a case can do that.
