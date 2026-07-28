-- 0002_tasks_notes.sql — the Phase 0 heart: tasks, notes, and their satellites.

-- ---------------------------------------------------------------------------
-- recurrence_rules — shared by tasks and events. Stores an RFC 5545 RRULE
-- string; expansion happens in the application, not the database.
-- ---------------------------------------------------------------------------
create table public.recurrence_rules (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  rrule       text not null,
  dtstart     timestamptz not null,
  until       timestamptz,
  timezone    text not null default 'Europe/London',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger recurrence_rules_touch before update on public.recurrence_rules
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- tasks
--
-- Smart lists are derived from these columns, never stored:
--   inbox      : due_on is null and deferred_until is null and status = 'todo'
--   today      : due_on <= today, or snoozed_until <= now
--   overdue    : due_on < today and status not in ('done','dropped')
--   upcoming   : due_on between tomorrow and +14 days
--   someday    : deferred_until is not null and deferred_until > now
--   waiting    : status = 'blocked'
--   done       : status = 'done'
-- ---------------------------------------------------------------------------
create table public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  space_id           uuid not null references public.spaces(id) on delete cascade,
  owner_id           uuid not null references public.profiles(id) on delete cascade,
  category_id        uuid references public.categories(id) on delete set null,
  parent_task_id     uuid references public.tasks(id) on delete cascade,
  recurrence_rule_id uuid references public.recurrence_rules(id) on delete set null,

  title              text not null,
  body_md            text not null default '',
  status             app.task_status not null default 'todo',
  priority           app.priority not null default 'none',
  visibility         app.visibility not null default 'space',

  -- Locked tasks are E2E encrypted: `title`/`body_md` are empty and the payload
  -- lives in encrypted_blobs. Enforced by tasks_locked_has_no_plaintext below.
  is_locked          boolean not null default false,

  due_on             date,
  due_at             timestamptz,
  deferred_until     timestamptz,
  snoozed_until      timestamptz,
  completed_at       timestamptz,

  assignee_id        uuid references public.profiles(id) on delete set null,
  waiting_on         text,
  estimate_minutes   integer check (estimate_minutes is null or estimate_minutes > 0),
  sort_order         integer not null default 0,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint tasks_locked_has_no_plaintext
    check (not is_locked or (title = '' and body_md = '')),
  constraint tasks_done_has_completed_at
    check (status <> 'done' or completed_at is not null),
  constraint tasks_not_own_parent
    check (parent_task_id is null or parent_task_id <> id)
);

create index tasks_space_status_idx  on public.tasks (space_id, status);
create index tasks_space_due_idx     on public.tasks (space_id, due_on) where status in ('todo','doing','blocked');
create index tasks_assignee_idx      on public.tasks (assignee_id) where status in ('todo','doing','blocked');
create index tasks_parent_idx        on public.tasks (parent_task_id);

-- Search excludes locked rows at the index level, not in application code.
create index tasks_search_idx on public.tasks
  using gin (to_tsvector('english', title || ' ' || body_md))
  where not is_locked;

create trigger tasks_touch before update on public.tasks
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- task_checklist_items — lightweight steps inside a task. Not sub-tasks; those
-- are tasks with a parent_task_id.
-- ---------------------------------------------------------------------------
create table public.task_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  label       text not null,
  done        boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index task_checklist_items_task_idx on public.task_checklist_items (task_id, sort_order);

create trigger task_checklist_items_touch before update on public.task_checklist_items
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------
create table public.notes (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,

  title       text not null default '',
  body_md     text not null default '',
  visibility  app.visibility not null default 'space',
  is_locked   boolean not null default false,
  pinned_at   timestamptz,
  archived_at timestamptz,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint notes_locked_has_no_plaintext
    check (not is_locked or (title = '' and body_md = ''))
);

create index notes_space_updated_idx on public.notes (space_id, updated_at desc);
create index notes_pinned_idx on public.notes (space_id, pinned_at desc) where pinned_at is not null;
create index notes_search_idx on public.notes
  using gin (to_tsvector('english', title || ' ' || body_md))
  where not is_locked;

create trigger notes_touch before update on public.notes
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- note_versions — every save snapshots the previous body. Cheap, and it is the
-- only recovery path a user has.
-- ---------------------------------------------------------------------------
create table public.note_versions (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  note_id     uuid not null references public.notes(id) on delete cascade,
  version     integer not null,
  title       text not null default '',
  body_md     text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint note_versions_space_note_version_key unique (space_id, note_id, version)
);

create trigger note_versions_touch before update on public.note_versions
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- note_links — a note attached to any entity. Polymorphic by (kind, id) because
-- a note can link to a person, an event, a place, or another note.
-- ---------------------------------------------------------------------------
create table public.note_links (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references public.spaces(id) on delete cascade,
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  note_id      uuid not null references public.notes(id) on delete cascade,
  entity_kind  app.entity_kind not null,
  entity_id    uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint note_links_space_note_entity_key unique (space_id, note_id, entity_kind, entity_id)
);

create index note_links_entity_idx on public.note_links (space_id, entity_kind, entity_id);

create trigger note_links_touch before update on public.note_links
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- attachments — metadata only. Bytes live in object storage, or, for locked
-- items, in encrypted_blobs.
-- ---------------------------------------------------------------------------
create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references public.spaces(id) on delete cascade,
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  entity_kind  app.entity_kind not null,
  entity_id    uuid not null,
  filename     text not null,
  mime_type    text not null,
  byte_size    bigint not null check (byte_size >= 0),
  storage_key  text,
  is_locked    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index attachments_entity_idx on public.attachments (space_id, entity_kind, entity_id);

create trigger attachments_touch before update on public.attachments
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- saved_views — a named filter. Smart lists ship as built-ins in code; this is
-- for the ones a user makes.
-- ---------------------------------------------------------------------------
create table public.saved_views (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  slug        text not null,
  entity_kind app.entity_kind not null default 'task',
  filter      jsonb not null default '{}'::jsonb,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint saved_views_space_slug_key unique (space_id, slug)
);

create trigger saved_views_touch before update on public.saved_views
  for each row execute function app.touch_updated_at();

-- ===========================================================================
-- RLS
-- ===========================================================================
select app.apply_standard_rls('recurrence_rules');
select app.apply_standard_rls('tasks', p_has_visibility => true);
select app.apply_standard_rls('task_checklist_items');
select app.apply_standard_rls('notes', p_has_visibility => true);
select app.apply_standard_rls('note_versions');
select app.apply_standard_rls('note_links');
select app.apply_standard_rls('attachments');
select app.apply_standard_rls('saved_views');
