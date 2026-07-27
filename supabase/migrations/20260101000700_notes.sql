set search_path = public, extensions;

-- ============================================================================
-- Orbit 0007 — Notes, daily notes, CRDT state, integrations
--
-- Note bodies exist in two representations:
--
--   body_md      the materialised markdown, used for search, export and read
--   yjs_state    the Yjs document state vector, the source of truth for edits
--
-- body_md is derived from yjs_state on write by an Edge Function. Reads and
-- search never touch the CRDT. See ADR §4(d) for why Yjs and not soft locking.
--
-- Encrypted notes (is_locked / is_sensitive) store body_cipher instead of
-- body_md, are excluded from the search index by a partial index predicate, and
-- are excluded from bulk move-to-shared by app.guard_sensitive_space_move().
-- ============================================================================

create table notes (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references spaces(id) on delete cascade,
  owner_id     uuid not null references auth.users(id),
  title        text,
  body_md      text,
  body_cipher  bytea,
  yjs_state    bytea,
  template     text,                       -- meeting | one_to_one | trip | book | recipe | idea | decision
  is_daily     boolean not null default false,
  daily_date   date,
  is_locked    boolean not null default false,
  is_sensitive boolean not null default false,
  import_batch_id uuid,                    -- set by importers; makes imports reversible
  search_tsv   tsvector generated always as (
                 to_tsvector('english'::regconfig, coalesce(title,'') || ' ' || coalesce(body_md,''))
               ) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id),
  deleted_at   timestamptz,
  constraint locked_body_is_encrypted
    check (not (is_locked or is_sensitive) or body_md is null),
  constraint daily_has_date check (not is_daily or daily_date is not null),
  unique (space_id, owner_id, daily_date)
);

-- Locked and sensitive notes are structurally absent from the search index.
create index notes_search on notes using gin (search_tsv)
  where deleted_at is null and is_locked = false and is_sensitive = false;
create index notes_daily on notes (space_id, owner_id, daily_date desc) where is_daily;
create index notes_by_space on notes (space_id, updated_at desc) where deleted_at is null;

alter table interactions   add constraint interactions_note_fk
  foreign key (note_id) references notes(id) on delete set null;
alter table interactions   add constraint interactions_event_fk
  foreign key (event_id) references events(id) on delete set null;
alter table talking_points add constraint talking_points_note_fk
  foreign key (note_id) references notes(id) on delete set null;

-- Yjs update log. Clients append updates; a compaction job folds them into
-- notes.yjs_state. Append-only means offline clients can merge on reconnect
-- without a coordinator, which is the whole reason for choosing a CRDT.
create table note_updates (
  id         bigserial primary key,
  space_id   uuid not null references spaces(id) on delete cascade,
  owner_id   uuid not null references auth.users(id),
  note_id    uuid not null references notes(id) on delete cascade,
  update_bin bytea not null,
  client_id  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz
);
create index note_updates_stream on note_updates (space_id, note_id, id);

create table note_embeddings (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references spaces(id) on delete cascade,
  owner_id   uuid not null references auth.users(id),
  note_id    uuid not null references notes(id) on delete cascade,
  chunk_index int not null default 0,
  content    text,
  embedding  vector(1024),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (space_id, note_id, chunk_index)
);
create index note_embeddings_ann on note_embeddings
  using hnsw (embedding vector_cosine_ops);

create table import_batches (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references spaces(id) on delete cascade,
  owner_id     uuid not null references auth.users(id),
  source       text not null,             -- markdown | apple_notes | keep | notion | enex | vcf | csv
  filename     text,
  item_count   int not null default 0,
  status       text not null default 'previewing',  -- previewing | committed | reverted
  mapping_json jsonb,
  committed_at timestamptz,
  reverted_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id),
  deleted_at   timestamptz
);
alter table notes add constraint notes_import_batch_fk
  foreign key (import_batch_id) references import_batches(id) on delete set null;

-- ----------------------------------------------------------------------------
-- Integrations. Credentials are NOT stored here — only a reference into Vault.
-- The anon/authenticated roles have no policy on integration_credentials at
-- all, so a compromised client JWT cannot read a refresh token.
-- ----------------------------------------------------------------------------

create table integrations (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references spaces(id) on delete cascade,
  owner_id     uuid not null references auth.users(id),
  provider     calendar_source not null,
  account_label text,
  scopes       text[],
  sync_frequency_minutes int not null default 30,
  last_sync_at timestamptz,
  status       sync_status not null default 'ok',
  status_detail text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id),
  deleted_at   timestamptz
);
alter table calendars add constraint calendars_integration_fk
  foreign key (integration_id) references integrations(id) on delete cascade;

create table integration_credentials (
  integration_id uuid primary key references integrations(id) on delete cascade,
  vault_secret_id uuid not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table integration_credentials enable row level security;
alter table integration_credentials force row level security;
-- Intentionally zero policies: only service_role (which bypasses RLS) reads this.
revoke all on integration_credentials from authenticated, anon;

create table notification_prefs (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references spaces(id) on delete cascade,
  owner_id      uuid not null references auth.users(id),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null,            -- morning_brief | evening_review | weekly_review | birthday | cadence | event | arrival | space_digest
  enabled       boolean not null default false,   -- default to fewer
  send_at_local time,
  lead_minutes  int,
  channel       text not null default 'push',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  unique (user_id, kind)
);

create table devices (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references spaces(id) on delete cascade,
  owner_id       uuid not null references auth.users(id),
  user_id        uuid not null references auth.users(id) on delete cascade,
  label          text,
  platform       text,
  push_token     text,
  last_seen_at   timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id),
  deleted_at     timestamptz
);
