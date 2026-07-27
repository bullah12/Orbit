-- 0006_automation.sql — rules engine, reminders, notification delivery.
--
-- The rules engine is a declared bug farm. Everything a run did is recorded in
-- rule_runs, including dry runs, so a wrong rule can be diagnosed after the
-- fact rather than reproduced.

create table public.rules (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references public.spaces(id) on delete cascade,
  owner_id       uuid not null references public.profiles(id) on delete cascade,
  name           text not null,
  slug           text not null,
  description    text not null default '',

  -- trigger: {"kind":"task.created"} | {"kind":"schedule","cron":"0 7 * * *"} | ...
  trigger        jsonb not null,
  -- conditions: [{"field":"category.slug","op":"eq","value":"admin"}, ...]
  conditions     jsonb not null default '[]'::jsonb,
  -- actions: [{"kind":"task.set_priority","priority":"high"}, ...]
  actions        jsonb not null default '[]'::jsonb,

  is_enabled     boolean not null default false,
  -- A rule must be dry-run at least once before it can be enabled. Enforced in
  -- the application; recorded here so the UI can say why the toggle is locked.
  last_dry_run_at timestamptz,
  last_run_at    timestamptz,
  run_count      integer not null default 0,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint rules_space_slug_key unique (space_id, slug),
  constraint rules_conditions_is_array check (jsonb_typeof(conditions) = 'array'),
  constraint rules_actions_is_array check (jsonb_typeof(actions) = 'array'),
  constraint rules_trigger_is_object check (jsonb_typeof(trigger) = 'object')
);

create index rules_enabled_idx on public.rules (space_id) where is_enabled;

create trigger rules_touch before update on public.rules
  for each row execute function app.touch_updated_at();

create table public.rule_runs (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references public.spaces(id) on delete cascade,
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  rule_id       uuid not null references public.rules(id) on delete cascade,
  is_dry_run    boolean not null default false,
  trigger_kind  text not null,
  entity_kind   app.entity_kind,
  entity_id     uuid,
  matched       boolean not null,
  -- What the run did, or would have done: [{"kind":"...","before":…,"after":…}]
  effects       jsonb not null default '[]'::jsonb,
  error         text,
  duration_ms   integer,
  ran_at        timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint rule_runs_effects_is_array check (jsonb_typeof(effects) = 'array')
);

create index rule_runs_rule_idx on public.rule_runs (space_id, rule_id, ran_at desc);

create trigger rule_runs_touch before update on public.rule_runs
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- reminders — attached to any entity. Delivery is a separate table so a retry
-- does not lose the schedule.
-- ---------------------------------------------------------------------------
create table public.reminders (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references public.spaces(id) on delete cascade,
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  entity_kind  app.entity_kind not null,
  entity_id    uuid not null,
  remind_at    timestamptz not null,
  channel      text not null default 'in_app' check (channel in ('in_app', 'push')),
  message      text not null default '',
  -- Never a nag. One reminder fires once; there is no escalation ladder and no
  -- streak. See the standing rules in docs/phase-plan.md.
  fired_at     timestamptz,
  dismissed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index reminders_due_idx on public.reminders (space_id, remind_at)
  where fired_at is null and dismissed_at is null;
create index reminders_entity_idx on public.reminders (space_id, entity_kind, entity_id);

create trigger reminders_touch before update on public.reminders
  for each row execute function app.touch_updated_at();

create table public.notification_deliveries (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references public.spaces(id) on delete cascade,
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  reminder_id   uuid references public.reminders(id) on delete cascade,
  device_id     uuid references public.devices(id) on delete set null,
  channel       text not null check (channel in ('in_app', 'push')),
  status        text not null default 'queued'
                  check (status in ('queued', 'sent', 'failed', 'skipped')),
  provider      text not null default 'fake',
  error         text,
  attempts      integer not null default 0,
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index notification_deliveries_queue_idx on public.notification_deliveries (space_id, status, created_at);

create trigger notification_deliveries_touch before update on public.notification_deliveries
  for each row execute function app.touch_updated_at();

-- ===========================================================================
-- RLS
-- ===========================================================================
select app.apply_standard_rls('rules');
select app.apply_standard_rls('rule_runs');
select app.apply_standard_rls('reminders');
select app.apply_standard_rls('notification_deliveries');
