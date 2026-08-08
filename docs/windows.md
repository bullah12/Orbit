# Working on Orbit from Windows

Orbit runs on Linux. Editing it from Windows with the clone on the Windows
filesystem — `C:\Users\you\Documents\...`, reached from WSL as `/mnt/c/...` — is
a normal way to work on it and is what this file is for. Everything here is a
consequence of one filesystem being seen by two operating systems.

Nothing in this file is required if you clone inside WSL's own filesystem
(`~/Orbit`). That is faster and has none of these problems. It is also invisible
from Windows Explorer, which is why people do not do it.

---

## Line endings

**`.gitattributes` settles this** and you should not need to think about it. The
repository is LF in the working tree on every platform, because three things
here break outright on CRLF:

| | what you actually see |
|---|---|
| `*.sh` | `/usr/bin/env: 'bash\r': No such file or directory` — names the interpreter, not the problem |
| `*.sql` | psql carries the `\r` into string literals and function bodies |
| `*.mjs` | `scripts/smoke.mjs` is run by node directly |

`.ps1`, `.bat` and `.cmd` keep CRLF, because PowerShell wants it.

Set this once in **both** gits — the WSL one and the Windows one — so nothing
rewrites the tree behind the attributes file:

```sh
git config --global core.autocrlf false
```

### If a tree is already mangled

The symptom is unmistakable and alarming: **every file in the repository shows
as modified**, including ones you have never opened — `pnpm-lock.yaml`,
`tsconfig.json`, `postcss.config.mjs` — and `git switch` refuses to move
branches because it "would overwrite local changes".

Prove it is only line endings before you throw anything away:

```sh
git diff --ignore-cr-at-eol --stat | tail -3
```

**Silence means there is no real change in there.** If it lists files, those are
genuine edits — deal with them first. Once you are sure:

```sh
git checkout -- .            # discard the whole CRLF diff
git switch your-branch       # now moves
```

A clone made after `.gitattributes` existed will not get into this state at all.

---

## The dev loop

**`pnpm dev` will not notice your edits.** WSL's inotify does not fire for
writes that arrive from the Windows side of `/mnt/c`, so the file watcher sees
nothing and nothing hot-reloads. Poll instead:

```sh
WATCHPACK_POLLING=true pnpm dev
```

**`pnpm install` is slow here**, and so is every build. `node_modules` is tens of
thousands of small files and each one crosses the filesystem boundary. It works;
it is just several times slower than the same command inside WSL.

**If a script refuses to run** with `Permission denied`, the executable bit did
not survive the mount. Run it through bash rather than fixing the mount:

```sh
bash scripts/db-reset.sh
```

**`./scripts/db-reset.sh` expects Postgres inside WSL**, not a Windows install —
it uses `su postgres -c` and `pg_ctlcluster`. A Windows-side PostgreSQL will not
be driven by it. Install `postgresql-16`, `postgresql-16-postgis-3`,
`postgresql-16-pgvector` and `postgresql-16-pgtap` in the WSL distribution and
let the script do the rest.

---

## Reaching Supabase from WSL

**The direct connection does not work from WSL and this is not your network.**
`db.<ref>.supabase.co` resolves to an IPv6 address and has no A record at all;
WSL2's default NAT networking has no IPv6 route, so you get:

```
psql: error: connection to server at "db.<ref>.supabase.co" (2a05:...), port 5432 failed:
Network is unreachable
```

Use the **session pooler** instead — dashboard → **Connect** → *Session pooler*.
It is IPv4 and it is what Supabase provides for this case.

```sh
export PGHOST='aws-0-YOUR-REGION.pooler.supabase.com'
export PGPORT='5432'
export PGDATABASE='postgres'
export PGUSER='postgres.YOUR-REF'
export PGPASSWORD='YOUR-PASSWORD'
```

Two things about that connection:

- **The username is `postgres.YOUR-REF`**, not `postgres`. Same role and same
  privileges; the pooler needs the project ref to route you.
- **Port 5432, not 6543.** 5432 is session mode — a real session, so DDL,
  `create role` and the `auth.users` trigger all behave. 6543 is transaction
  mode and hands each statement to a different backend, which is wrong for
  migrations and needs `DATABASE_PREPARE=false` for the app besides.

Use the pooler for the deployed app's `DATABASE_URL` too. Railway has no IPv6
egress either.

`./scripts/db-test.sh` runs a local `psql` as the `postgres` OS user and cannot
be pointed at Supabase. To run the pgTAP suite against a real project, invoke it
directly — it runs in a transaction and rolls back, leaving nothing behind:

```sh
psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation_test.sql
```
