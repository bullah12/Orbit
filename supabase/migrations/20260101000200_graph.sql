-- ============================================================================
-- Orbit 0002 — the spine: tags, taggings, links, attachments
--
-- THE LEAK PROBLEM
-- ----------------
-- A link joins two entities that may live in different spaces. If my partner
-- can see a shared event, and that event is linked to a note in my Personal
-- space, they must see no trace of the note: no row, no count, no placeholder.
--
-- Doing that with a function that dereferences the target row per link is both
-- slow and fragile. Instead every link row denormalises the space of BOTH
-- endpoints, maintained exclusively by SECURITY DEFINER triggers (clients
-- cannot set these columns — the trigger overwrites whatever is supplied).
--
-- Visibility then reduces to a pure column predicate on the link row itself:
--
--     source_space_id = any(readable) AND target_space_id = any(readable)
--
-- The row simply does not exist for anyone who cannot see both ends, which is
-- what makes counts and aggregates safe for free. `taggings` uses the same
-- trick for the same reason: otherwise the tag list on a shared item leaks the
-- existence of private items carrying that tag.
-- ============================================================================

create table tags (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references spaces(id) on delete cascade,
  owner_id   uuid not null references auth.users(id),
  name       citext not null,
  colour     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (space_id, name)
);

create table taggings (
  id              uuid primary key default gen_random_uuid(),
  tag_id          uuid not null references tags(id) on delete cascade,
  entity_type     entity_type not null,
  entity_id       uuid not null,
  -- Denormalised, trigger-maintained. Never client-writable.
  entity_space_id uuid not null references spaces(id) on delete cascade,
  tag_space_id    uuid not null references spaces(id) on delete cascade,
  space_id        uuid not null references spaces(id) on delete cascade,
  owner_id        uuid not null references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id),
  deleted_at      timestamptz,
  unique (tag_id, entity_type, entity_id)
);

create table links (
  id              uuid primary key default gen_random_uuid(),
  source_type     entity_type not null,
  source_id       uuid not null,
  target_type     entity_type not null,
  target_id       uuid not null,
  link_type       link_type not null default 'related_to',
  -- Denormalised, trigger-maintained. Never client-writable.
  source_space_id uuid not null references spaces(id) on delete cascade,
  target_space_id uuid not null references spaces(id) on delete cascade,
  -- space_id here means "the space the link itself was authored in"; it is not
  -- what governs visibility. Kept for the uniform column contract and audit.
  space_id        uuid not null references spaces(id) on delete cascade,
  owner_id        uuid not null references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id),
  deleted_at      timestamptz,
  constraint no_self_link check (not (source_type = target_type and source_id = target_id)),
  unique (source_type, source_id, target_type, target_id, link_type)
);

-- Indexed in both directions, each led by the space column that gates it.
create index links_forward  on links (source_space_id, source_type, source_id) where deleted_at is null;
create index links_backward on links (target_space_id, target_type, target_id) where deleted_at is null;
create index links_pair     on links (source_space_id, target_space_id) where deleted_at is null;

create index taggings_by_entity on taggings (entity_space_id, entity_type, entity_id) where deleted_at is null;
create index taggings_by_tag    on taggings (tag_space_id, tag_id) where deleted_at is null;

create table attachments (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references spaces(id) on delete cascade,
  owner_id     uuid not null references auth.users(id),
  entity_type  entity_type not null,
  entity_id    uuid not null,
  storage_path text not null,
  filename     text,
  mime         text,
  bytes        bigint,
  ocr_text     text,
  transcript   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id),
  deleted_at   timestamptz
);
create index attachments_by_entity on attachments (space_id, entity_type, entity_id) where deleted_at is null;

create table saved_filters (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references spaces(id) on delete cascade,
  owner_id    uuid not null references auth.users(id),
  name        text not null,
  entity_type entity_type not null,
  rule_json   jsonb not null default '{}'::jsonb,
  pinned      boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  deleted_at  timestamptz
);
