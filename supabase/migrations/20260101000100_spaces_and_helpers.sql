-- ============================================================================
-- Orbit 0001 — spaces, membership, ad-hoc shares, and the access-control core
-- ============================================================================

create table spaces (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  kind          space_kind not null,
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id),
  archived_at   timestamptz,
  -- Personal spaces are 1:1 with a user and can never gain a second member.
  constraint personal_space_name check (kind <> 'personal' or name = 'Personal')
);

create table space_members (
  space_id      uuid not null references spaces(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete cascade,
  invited_email citext,
  role          space_role not null default 'editor',
  status        membership_status not null default 'invited',
  invited_by    uuid references auth.users(id),
  invite_token  uuid unique,
  invited_at    timestamptz not null default now(),
  joined_at     timestamptz,
  left_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint member_identified check (user_id is not null or invited_email is not null)
);

-- No composite PK: membership is keyed on user_id once accepted and on
-- invited_email while pending, which a single PK cannot express.
create unique index space_members_user_uniq
  on space_members (space_id, user_id) where user_id is not null;
create unique index space_members_email_uniq
  on space_members (space_id, lower(invited_email::text)) where invited_email is not null;
create index space_members_by_user on space_members (user_id, status) where status = 'active';

-- Ad-hoc per-item sharing. Table and policies exist from migration one; the UI
-- for it is deliberately deferred to Phase 4 (see docs/phase-plan.md).
create table shares (
  id                  uuid primary key default gen_random_uuid(),
  entity_type         entity_type not null,
  entity_id           uuid not null,
  entity_space_id     uuid not null references spaces(id) on delete cascade,
  shared_with_user_id uuid not null references auth.users(id) on delete cascade,
  permission          share_permission not null default 'view',
  created_by          uuid not null references auth.users(id),
  created_at          timestamptz not null default now(),
  expires_at          timestamptz,
  revoked_at          timestamptz,
  unique (entity_type, entity_id, shared_with_user_id)
);
create index shares_lookup
  on shares (shared_with_user_id, entity_type, entity_id)
  where revoked_at is null;

create table activity_log (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references spaces(id) on delete cascade,
  actor_id    uuid not null references auth.users(id),
  entity_type entity_type not null,
  entity_id   uuid not null,
  action      text not null,
  summary     text,
  at          timestamptz not null default now()
);
create index activity_log_by_space on activity_log (space_id, at desc);

-- ============================================================================
-- The access-control core.
--
-- All four functions are SECURITY DEFINER with a pinned search_path. They read
-- space_members directly, which is what breaks the RLS recursion that would
-- otherwise occur (a policy on space_members that queries space_members).
--
-- They are STABLE and take no arguments, so Postgres evaluates each once per
-- statement as an InitPlan rather than once per row. This is why policies are
-- written as `space_id = any(app.readable_space_ids())` and not as
-- `app.is_member(space_id)` — the latter is a per-row function call and shows
-- up immediately at 10k rows.
-- ============================================================================

create or replace function app.space_ids_with_role(min_role space_role)
returns uuid[]
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(array_agg(space_id), '{}'::uuid[])
  from space_members
  where user_id = (select auth.uid())
    and status = 'active'
    and role >= min_role;
$$;

-- Read access. Note this EXCLUDES free_busy members: they are not permitted to
-- read event rows at all. They see busy blocks through app.busy_blocks only.
create or replace function app.readable_space_ids()
returns uuid[] language sql stable
set search_path = public, app, pg_temp
as $$ select app.space_ids_with_role('viewer') $$;

create or replace function app.writable_space_ids()
returns uuid[] language sql stable
set search_path = public, app, pg_temp
as $$ select app.space_ids_with_role('editor') $$;

create or replace function app.owned_space_ids()
returns uuid[] language sql stable
set search_path = public, app, pg_temp
as $$ select app.space_ids_with_role('owner') $$;

-- Every membership, including free_busy. Used only for the busy-block view.
create or replace function app.member_space_ids()
returns uuid[] language sql stable
set search_path = public, app, pg_temp
as $$ select app.space_ids_with_role('free_busy') $$;

-- Ad-hoc share fallback. Kept as a per-row EXISTS because it is the rare path;
-- the `shares` table is expected to hold tens of rows, not millions.
create or replace function app.has_share(et entity_type, eid uuid, need share_permission)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1
    from shares s
    where s.entity_type = et
      and s.entity_id   = eid
      and s.shared_with_user_id = (select auth.uid())
      and s.permission >= need
      and s.revoked_at is null
      and (s.expires_at is null or s.expires_at > now())
  );
$$;

-- ----------------------------------------------------------------------------
-- Policy macros, as text, so that every table's policies are literally the same
-- expression. Applied by 20260101000800_rls.sql via app.apply_standard_rls().
-- ----------------------------------------------------------------------------

-- et is null for tables that are not themselves shareable units (child rows,
-- junction tables); those get the space check only, with no `shares` fallback.
create or replace function app.apply_standard_rls(tbl regclass, et entity_type default null)
returns void
language plpgsql
as $$
declare
  t text := tbl::text;
  share_view text := case when et is null then 'false'
                     else format('app.has_share(%L, id, ''view'')', et) end;
  share_edit text := case when et is null then 'false'
                     else format('app.has_share(%L, id, ''edit'')', et) end;
begin
  execute format('alter table %s enable row level security', t);
  execute format('alter table %s force row level security', t);

  execute format($p$
    create policy %1$s_select on %2$s for select to authenticated
    using (
      deleted_at is null
      and ( space_id = any(app.readable_space_ids()) or %3$s )
    )$p$, replace(t, '.', '_'), t, share_view);

  execute format($p$
    create policy %1$s_insert on %2$s for insert to authenticated
    with check (
      space_id = any(app.writable_space_ids())
      and owner_id = (select auth.uid())
    )$p$, replace(t, '.', '_'), t);

  execute format($p$
    create policy %1$s_update on %2$s for update to authenticated
    using ( space_id = any(app.writable_space_ids()) or %3$s )
    with check ( space_id = any(app.writable_space_ids()) or %4$s )
    $p$, replace(t, '.', '_'), t, share_edit, share_edit);

  -- Hard delete is reserved for GDPR erasure RPCs. Clients soft-delete.
  execute format($p$
    create policy %1$s_delete on %2$s for delete to authenticated
    using ( space_id = any(app.owned_space_ids()) )$p$, replace(t, '.', '_'), t);

  execute format('create trigger touch_%1$s before update on %2$s
                  for each row execute function app.touch_updated_at()',
                 replace(t, '.', '_'), t);
end;
$$;

-- ----------------------------------------------------------------------------
-- Bootstrap: every user gets exactly one personal space, created by trigger so
-- that "default private" is a database fact and not an application convention.
-- ----------------------------------------------------------------------------

create or replace function app.provision_personal_space()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  sid uuid;
begin
  insert into spaces (name, kind, created_by) values ('Personal', 'personal', new.id)
  returning id into sid;
  insert into space_members (space_id, user_id, role, status, joined_at)
  values (sid, new.id, 'owner', 'active', now());
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.provision_personal_space();

create or replace function app.my_personal_space_id()
returns uuid
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select s.id
  from spaces s
  join space_members m on m.space_id = s.id
  where s.kind = 'personal' and m.user_id = (select auth.uid())
  limit 1;
$$;

-- A personal space must never gain a second member.
create or replace function app.forbid_personal_space_sharing()
returns trigger language plpgsql as $$
begin
  if (select kind from spaces where id = new.space_id) = 'personal'
     and exists (select 1 from space_members
                 where space_id = new.space_id
                   and status in ('invited','active')
                   and (user_id is distinct from new.user_id))
  then
    raise exception 'A personal space cannot be shared. Create a shared space instead.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger guard_personal_space
  before insert or update on space_members
  for each row execute function app.forbid_personal_space_sharing();

-- ----------------------------------------------------------------------------
-- RLS on the control-plane tables themselves.
-- ----------------------------------------------------------------------------

alter table spaces        enable row level security;
alter table space_members enable row level security;
alter table shares        enable row level security;
alter table activity_log  enable row level security;
alter table spaces        force row level security;
alter table space_members force row level security;
alter table shares        force row level security;
alter table activity_log  force row level security;

create policy spaces_select on spaces for select to authenticated
  using (id = any(app.member_space_ids()));
create policy spaces_insert on spaces for insert to authenticated
  with check (created_by = (select auth.uid()) and kind = 'shared');
create policy spaces_update on spaces for update to authenticated
  using (id = any(app.owned_space_ids())) with check (id = any(app.owned_space_ids()));

-- A member sees the roster of their own spaces, and nothing else. Crucially
-- there is no policy that lets you see spaces you were never invited to, so a
-- non-member cannot even confirm a space id exists.
create policy space_members_select on space_members for select to authenticated
  using (space_id = any(app.member_space_ids()) or user_id = (select auth.uid()));
create policy space_members_insert on space_members for insert to authenticated
  with check (space_id = any(app.owned_space_ids()));
create policy space_members_update on space_members for update to authenticated
  using (space_id = any(app.owned_space_ids()) or user_id = (select auth.uid()))
  with check (space_id = any(app.owned_space_ids()) or user_id = (select auth.uid()));
create policy space_members_delete on space_members for delete to authenticated
  using (space_id = any(app.owned_space_ids()));

create policy shares_select on shares for select to authenticated
  using (created_by = (select auth.uid()) or shared_with_user_id = (select auth.uid()));
create policy shares_write on shares for all to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid())
              and entity_space_id = any(app.writable_space_ids()));

create policy activity_log_select on activity_log for select to authenticated
  using (space_id = any(app.readable_space_ids()));
