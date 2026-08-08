-- 0007_platform.sql — tags, item-level sharing, activity, AI consent, E2EE
-- envelopes, sync cursors, and orbit.space_move_preview().

-- Everything below lives in the `orbit` schema. The search_path names it
-- first so an unqualified CREATE cannot land in a schema this project
-- shares with somebody else's work, and names `public` and `extensions`
-- after it because that is where an installation puts PostGIS and pgcrypto:
-- Supabase uses `extensions`, a local cluster uses `public`.
set search_path = orbit, public, extensions, pg_catalog;


create table orbit.tags (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references orbit.spaces(id) on delete cascade,
  owner_id    uuid not null references orbit.profiles(id) on delete cascade,
  name        text not null,
  slug        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint tags_space_slug_key unique (space_id, slug)
);

create trigger tags_touch before update on orbit.tags
  for each row execute function orbit.touch_updated_at();

create table orbit.taggings (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references orbit.spaces(id) on delete cascade,
  owner_id    uuid not null references orbit.profiles(id) on delete cascade,
  tag_id      uuid not null references orbit.tags(id) on delete cascade,
  entity_kind orbit.entity_kind not null,
  entity_id   uuid not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint taggings_space_tag_entity_key unique (space_id, tag_id, entity_kind, entity_id)
);

create index taggings_entity_idx on orbit.taggings (space_id, entity_kind, entity_id);

create trigger taggings_touch before update on orbit.taggings
  for each row execute function orbit.touch_updated_at();

-- ---------------------------------------------------------------------------
-- item_shares — narrows or widens a single item within a space. A row here can
-- grant a specific member access to a `private` item without moving it.
--
-- It can never grant access ACROSS spaces: the grantee must already be a member
-- of the item's space. Cross-space sharing is a move, and a move goes through
-- orbit.space_move_preview().
-- ---------------------------------------------------------------------------
create table orbit.item_shares (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references orbit.spaces(id) on delete cascade,
  owner_id     uuid not null references orbit.profiles(id) on delete cascade,
  entity_kind  orbit.entity_kind not null,
  entity_id    uuid not null,
  grantee_id   uuid not null references orbit.profiles(id) on delete cascade,
  access       text not null default 'read' check (access in ('read', 'write')),
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint item_shares_space_entity_grantee_key
    unique (space_id, entity_kind, entity_id, grantee_id)
);

create index item_shares_grantee_idx on orbit.item_shares (grantee_id) where revoked_at is null;

create trigger item_shares_touch before update on orbit.item_shares
  for each row execute function orbit.touch_updated_at();

-- ---------------------------------------------------------------------------
-- activity_log — what CHANGED, never who LOOKED.
--
-- There is no read/view event kind and there must never be one. See the
-- standing rules: no "who viewed what" tracking, ever. The check constraint is
-- there so a future session has to delete a line of SQL to break the promise.
-- ---------------------------------------------------------------------------
create table orbit.activity_log (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references orbit.spaces(id) on delete cascade,
  owner_id     uuid not null references orbit.profiles(id) on delete cascade,
  actor_id     uuid references orbit.profiles(id) on delete set null,
  entity_kind  orbit.entity_kind not null,
  entity_id    uuid not null,
  action       text not null,
  summary      text not null default '',
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint activity_log_no_view_tracking
    check (action in ('created', 'updated', 'deleted', 'completed', 'reopened',
                      'moved', 'shared', 'unshared', 'linked', 'unlinked',
                      'locked', 'unlocked', 'imported', 'synced'))
);

create index activity_log_entity_idx on orbit.activity_log (space_id, entity_kind, entity_id, created_at desc);

create trigger activity_log_touch before update on orbit.activity_log
  for each row execute function orbit.touch_updated_at();

-- ---------------------------------------------------------------------------
-- AI — off by default, per-feature opt-in (decision 8).
-- ---------------------------------------------------------------------------
create table orbit.ai_feature_consents (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references orbit.spaces(id) on delete cascade,
  owner_id     uuid not null references orbit.profiles(id) on delete cascade,
  feature      text not null,
  -- Default false, and the column default matters: a row appearing by accident
  -- must not turn a feature on.
  is_enabled   boolean not null default false,
  -- Plain-language statement of what leaves the device, shown in settings next
  -- to the toggle. Required — a feature cannot be consented to in the abstract.
  data_leaves_device text not null,
  consented_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint ai_feature_consents_space_owner_feature_key
    unique (space_id, owner_id, feature),
  constraint ai_feature_consents_enabled_needs_consent
    check (not is_enabled or consented_at is not null)
);

create trigger ai_feature_consents_touch before update on orbit.ai_feature_consents
  for each row execute function orbit.touch_updated_at();

create table orbit.ai_runs (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references orbit.spaces(id) on delete cascade,
  owner_id      uuid not null references orbit.profiles(id) on delete cascade,
  feature       text not null,
  provider      text not null default 'fake',
  model         text,
  entity_kind   orbit.entity_kind,
  entity_id     uuid,
  input_tokens  integer,
  output_tokens integer,
  status        text not null default 'ok' check (status in ('ok', 'error', 'refused')),
  error         text,
  ran_at        timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index ai_runs_feature_idx on orbit.ai_runs (space_id, feature, ran_at desc);

create trigger ai_runs_touch before update on orbit.ai_runs
  for each row execute function orbit.touch_updated_at();

-- ---------------------------------------------------------------------------
-- encrypted_blobs — the E2EE envelope for is_locked items (decision 1).
--
-- The server stores ciphertext and nothing else. There is no plaintext column
-- and there must never be one. Locked content is excluded from every search
-- index and every AI path by construction: nothing here is indexable.
-- ---------------------------------------------------------------------------
create table orbit.encrypted_blobs (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references orbit.spaces(id) on delete cascade,
  owner_id      uuid not null references orbit.profiles(id) on delete cascade,
  entity_kind   orbit.entity_kind not null,
  entity_id     uuid not null,
  -- Opaque. Base64 of the client's sealed box.
  ciphertext    text not null,
  nonce         text not null,
  algorithm     text not null default 'xchacha20poly1305',
  key_version   integer not null default 1,
  -- Which devices can open it. Ordinary array, not a FK, because a revoked
  -- device must not cascade-delete the ciphertext.
  device_ids    uuid[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint encrypted_blobs_space_entity_key unique (space_id, entity_kind, entity_id)
);

create trigger encrypted_blobs_touch before update on orbit.encrypted_blobs
  for each row execute function orbit.touch_updated_at();

-- ---------------------------------------------------------------------------
-- sync_cursors — per device, per entity kind. Phase 6 lives off this.
-- ---------------------------------------------------------------------------
create table orbit.sync_cursors (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references orbit.spaces(id) on delete cascade,
  owner_id     uuid not null references orbit.profiles(id) on delete cascade,
  device_id    uuid not null references orbit.devices(id) on delete cascade,
  entity_kind  orbit.entity_kind not null,
  cursor_at    timestamptz not null default 'epoch',
  last_sync_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint sync_cursors_space_device_kind_key unique (space_id, device_id, entity_kind)
);

create trigger sync_cursors_touch before update on orbit.sync_cursors
  for each row execute function orbit.touch_updated_at();

-- ===========================================================================
-- RLS
-- ===========================================================================
select orbit.apply_standard_rls('tags');
select orbit.apply_standard_rls('taggings');
select orbit.apply_standard_rls('activity_log');
select orbit.apply_standard_rls('ai_runs');
select orbit.apply_standard_rls('encrypted_blobs');
select orbit.apply_standard_rls('sync_cursors');

-- item_shares: space members see them; the grantee sees their own grants.
alter table orbit.item_shares enable row level security;
grant select, insert, update, delete on orbit.item_shares to authenticated;

create policy item_shares_select on orbit.item_shares for select to authenticated
using (orbit.can_read_space(space_id) or grantee_id = auth.uid());

-- The grantee must already be a member of this space. This is the constraint
-- that stops item_shares becoming a back door around space membership.
create policy item_shares_insert on orbit.item_shares for insert to authenticated
with check (
  orbit.can_write_space(space_id)
  and owner_id = auth.uid()
  and exists (
    select 1 from orbit.space_members m
    where m.space_id = item_shares.space_id
      and m.user_id = item_shares.grantee_id
      and m.status = 'active'
  )
);

create policy item_shares_update on orbit.item_shares for update to authenticated
using (orbit.can_write_space(space_id) and (owner_id = auth.uid() or orbit.is_space_admin(space_id)))
with check (orbit.can_write_space(space_id) and (owner_id = auth.uid() or orbit.is_space_admin(space_id)));

create policy item_shares_delete on orbit.item_shares for delete to authenticated
using (orbit.can_write_space(space_id) and (owner_id = auth.uid() or orbit.is_space_admin(space_id)));

-- ai_feature_consents: yours alone. An admin cannot consent on your behalf.
alter table orbit.ai_feature_consents enable row level security;
grant select, insert, update, delete on orbit.ai_feature_consents to authenticated;

create policy ai_feature_consents_select on orbit.ai_feature_consents for select to authenticated
using (owner_id = auth.uid() and orbit.can_read_space(space_id));

create policy ai_feature_consents_insert on orbit.ai_feature_consents for insert to authenticated
with check (owner_id = auth.uid() and orbit.can_write_space(space_id));

create policy ai_feature_consents_update on orbit.ai_feature_consents for update to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy ai_feature_consents_delete on orbit.ai_feature_consents for delete to authenticated
using (owner_id = auth.uid());

-- ===========================================================================
-- orbit.space_move_preview()
--
-- HARD REQUIREMENT: every move confirmation calls this first and shows the
-- result. It answers one question in plain terms — who gains sight of this
-- item, and who loses it — before anything is written.
-- ===========================================================================
create or replace function orbit.space_move_preview(
  p_entity_kind orbit.entity_kind,
  p_entity_id uuid,
  p_target_space_id uuid
)
returns table (
  change       text,        -- 'gains' | 'loses' | 'keeps'
  profile_id   uuid,
  display_name text,
  role         orbit.member_role,
  reason       text
)
language plpgsql
stable
security definer
set search_path = orbit, pg_temp
as $$
declare
  v_source_space uuid;
begin
  -- Resolve the item's current space, honouring RLS: if the caller cannot read
  -- the item, they get nothing rather than a membership listing.
  execute format(
    'select space_id from orbit.%I where id = $1',
    case p_entity_kind
      when 'task'  then 'tasks'
      when 'note'  then 'notes'
      when 'person' then 'people'
      when 'event' then 'events'
      when 'place' then 'places'
      when 'travel_leg' then 'travel_legs'
      when 'rule'  then 'rules'
      else null
    end
  )
  into v_source_space
  using p_entity_id;

  if v_source_space is null then
    raise exception 'space_move_preview: unknown or unreadable % %', p_entity_kind, p_entity_id
      using errcode = 'no_data_found';
  end if;

  if not orbit.can_read_space(v_source_space) then
    raise exception 'space_move_preview: not a member of the source space'
      using errcode = 'insufficient_privilege';
  end if;

  if not orbit.can_write_space(p_target_space_id) then
    raise exception 'space_move_preview: cannot write to the target space'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  with src as (
    select m.user_id, m.role from orbit.space_members m
    where m.space_id = v_source_space and m.status = 'active' and m.role <> 'free_busy'
  ),
  tgt as (
    select m.user_id, m.role from orbit.space_members m
    where m.space_id = p_target_space_id and m.status = 'active' and m.role <> 'free_busy'
  )
  select
    case
      when src.user_id is null then 'gains'
      when tgt.user_id is null then 'loses'
      else 'keeps'
    end                                             as change,
    coalesce(tgt.user_id, src.user_id)              as profile_id,
    p.display_name,
    coalesce(tgt.role, src.role)                    as role,
    case
      when src.user_id is null then 'is a member of the destination space but not the current one'
      when tgt.user_id is null then 'is a member of the current space but not the destination'
      else 'is a member of both spaces'
    end                                             as reason
  from src
  full outer join tgt on tgt.user_id = src.user_id
  join orbit.profiles p on p.id = coalesce(tgt.user_id, src.user_id)
  order by 1, 3;
end $$;

grant execute on function orbit.space_move_preview(orbit.entity_kind, uuid, uuid) to authenticated;
