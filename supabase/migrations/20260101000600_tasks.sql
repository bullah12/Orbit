set search_path = public, extensions;

-- ============================================================================
-- Orbit 0006 — Tasks
--
-- owner_id (who asked) and assignee_user_id (who does it) are separate fields,
-- and reminders are generated from assignee_user_id ONLY. That single rule is
-- what stops a shared task list becoming a nagging machine: the app can never
-- notify you about work you delegated, only about work that is yours.
-- ============================================================================

create table tasks (
  id                uuid primary key default gen_random_uuid(),
  space_id          uuid not null references spaces(id) on delete cascade,
  owner_id          uuid not null references auth.users(id),   -- "requested by"
  title             text not null,
  notes_md          text,
  due_at            timestamptz,
  due_is_date_only  boolean not null default true,
  defer_at          timestamptz,                 -- start date; hides from Today until then
  completed_at      timestamptz,
  completed_by      uuid references auth.users(id),
  cancelled_at      timestamptz,
  priority          smallint not null default 0, -- 0 none .. 3 high
  effort_minutes    smallint,                    -- 5 | 15 | 30 | 60 | 120
  energy            task_energy,
  project_id        uuid references projects(id) on delete set null,
  parent_task_id    uuid references tasks(id) on delete cascade,
  sort_order        double precision not null default 0,
  someday           boolean not null default false,
  rrule             text,
  rrule_mode        rrule_mode not null default 'fixed',
  rrule_series_id   uuid,
  -- Waiting On: delegated to, or blocked by, a person. Surfaces on their
  -- profile and in the pre-meeting brief.
  waiting_on_person_id uuid references people(id) on delete set null,
  waiting_on_person_space_id uuid references spaces(id) on delete cascade,
  waiting_since     timestamptz,
  assignee_user_id  uuid references auth.users(id) on delete set null,
  rotate_assignee   boolean not null default false,   -- household chore rota
  rotation_order    uuid[] not null default '{}',     -- user ids, cycled on completion
  -- Time-blocking: the task appears on the calendar but stays a task.
  scheduled_event_id uuid references events(id) on delete set null,
  search_tsv        tsvector generated always as (
                      to_tsvector('english'::regconfig, coalesce(title,'') || ' ' || coalesce(notes_md,''))
                    ) stored,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id),
  deleted_at        timestamptz,
  constraint rotation_needs_recurrence check (not rotate_assignee or rrule is not null)
);

alter table events add constraint events_source_task_fk
  foreign key (source_task_id) references tasks(id) on delete set null;

-- Indexes are shaped around the smart lists, which are the only way anyone
-- actually reads this table.
create index tasks_open_due  on tasks (space_id, due_at)
  where deleted_at is null and completed_at is null and cancelled_at is null;
create index tasks_assignee  on tasks (space_id, assignee_user_id, due_at)
  where deleted_at is null and completed_at is null;
create index tasks_requester on tasks (space_id, owner_id, due_at)
  where deleted_at is null and completed_at is null;
create index tasks_inbox     on tasks (space_id, created_at desc)
  where deleted_at is null and completed_at is null and due_at is null and defer_at is null and someday = false;
create index tasks_waiting   on tasks (waiting_on_person_space_id, waiting_on_person_id)
  where deleted_at is null and completed_at is null and waiting_on_person_id is not null;
create index tasks_project   on tasks (space_id, project_id) where deleted_at is null;
create index tasks_search    on tasks using gin (search_tsv);

create table task_contexts (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references spaces(id) on delete cascade,
  owner_id   uuid not null references auth.users(id),
  task_id    uuid not null references tasks(id) on delete cascade,
  context    text not null,                      -- @home @errands @phone @laptop @Birmingham
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (space_id, task_id, context)
);
create index task_contexts_lookup on task_contexts (space_id, context) where deleted_at is null;

-- Rolling recurrence ("2 weeks after I complete it") and fixed recurrence
-- ("every 2 weeks") differ only in what the next due date is computed from, so
-- both are handled by one trigger on completion.
create or replace function app.spawn_next_recurrence()
returns trigger
language plpgsql
as $$
declare
  next_assignee uuid;
  idx int;
begin
  if new.completed_at is null or old.completed_at is not null or new.rrule is null then
    return new;
  end if;

  if new.rotate_assignee and array_length(new.rotation_order, 1) > 0 then
    idx := coalesce(array_position(new.rotation_order, new.assignee_user_id), 0);
    next_assignee := new.rotation_order[(idx % array_length(new.rotation_order, 1)) + 1];
  else
    next_assignee := new.assignee_user_id;
  end if;

  insert into tasks (
    space_id, owner_id, title, notes_md, due_at, due_is_date_only, defer_at,
    priority, effort_minutes, energy, project_id, rrule, rrule_mode,
    rrule_series_id, assignee_user_id, rotate_assignee, rotation_order
  )
  values (
    new.space_id, new.owner_id, new.title, new.notes_md,
    -- 'fixed' advances from the previous due date; 'rolling' from completion.
    app.next_occurrence(new.rrule,
      case when new.rrule_mode = 'fixed' then coalesce(new.due_at, new.completed_at)
           else new.completed_at end),
    new.due_is_date_only, new.defer_at,
    new.priority, new.effort_minutes, new.energy, new.project_id,
    new.rrule, new.rrule_mode, coalesce(new.rrule_series_id, new.id),
    next_assignee, new.rotate_assignee, new.rotation_order
  );
  return new;
end;
$$;

-- Minimal RRULE advance for the subset tasks actually use (FREQ + INTERVAL).
-- Full RFC 5545 expansion for events happens in the Edge Function with rrule.js;
-- duplicating that in plpgsql would be two implementations to keep in step.
create or replace function app.next_occurrence(p_rrule text, p_from timestamptz)
returns timestamptz
language plpgsql
immutable
as $$
declare
  freq text := upper(coalesce(substring(p_rrule from 'FREQ=([A-Z]+)'), 'WEEKLY'));
  ival int  := coalesce(nullif(substring(p_rrule from 'INTERVAL=([0-9]+)'), '')::int, 1);
begin
  return case freq
    when 'DAILY'   then p_from + (ival || ' days')::interval
    when 'WEEKLY'  then p_from + (ival || ' weeks')::interval
    when 'MONTHLY' then p_from + (ival || ' months')::interval
    when 'YEARLY'  then p_from + (ival || ' years')::interval
    else p_from + (ival || ' weeks')::interval
  end;
end;
$$;

create trigger tasks_recurrence after update of completed_at on tasks
  for each row execute function app.spawn_next_recurrence();
