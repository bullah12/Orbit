# Apply Orbit SQL from this PC

These commands use the Supabase CLI installed in the Ubuntu WSL distribution
to update the existing hosted Orbit project (`histxhywpsnazvgcacsv`). They do
not require Docker or a local database. Run them in a Windows terminal from
the project folder.

## Sign in once

```powershell
pnpm db:login
```

Open the login URL printed by Supabase, sign in, and enter the verification
code in that terminal. Do not paste access tokens or database passwords into
chat or commit them to the repository. The CLI manages its login credentials.

## Preview, then apply

```powershell
pnpm db:status
pnpm db:plan
pnpm db:migrate
```

`db:status` compares local and remote migration history. `db:plan` previews
pending migrations without applying them. `db:migrate` applies pending files
after the CLI's confirmation prompt. Read the list before confirming: for the
personal-dashboard change, the new file is `0023_personal_dashboard.sql`.
If older migrations are also pending, review them before proceeding.

The wrapper verifies the local project link before contacting the database.
It never runs reset, seed, history repair, or test commands. If history differs,
investigate rather than forcing `--include-all` or changing recorded versions.

After applying, run `pnpm db:status` again to confirm the version is recorded
remotely. Frontend deployment is a separate step.

As of 2026-09-26, login is complete and migrations 0022 and 0023 are applied.
Remote history matches local files through 0023; a subsequent dry-run reports
that the database is up to date. The frontend still needs its own deployment.

The CLI may warn that its optional pg-delta catalog cache needs Docker after
applying migrations. This session's push exited successfully despite that local
cache warning. Confirm remote state with db:status and db:plan before retrying;
do not assume the SQL failed or reapply it manually because of this warning.
