-- 0015_default_spaces.sql — everybody starts with Personal and Work.
--
-- 0014 made it *possible* to create a space. This makes it unnecessary: an
-- account arrives with two, and the empty-handed state that 0014's form exists
-- to rescue somebody from is one almost nobody will ever be in.
--
-- Two, not one, because the first decision Orbit asks of a person is the one it
-- is worst at explaining: a space is an audience, and you only learn what that
-- means by having two of them. "Personal" and "Work" is the split nearly
-- everybody already has in their head, and a household space — the one that
-- needs a second person in it — is better made deliberately, on the screen that
-- also offers the invitation.
--
-- ---------------------------------------------------------------------------
-- Personal cannot be deleted. Work can.
-- ---------------------------------------------------------------------------
--
-- Deleting a space deletes everything in it: every `space_id` column in this
-- schema is `on delete cascade`, which is right — a space *is* its contents,
-- and leaving orphaned rows with no audience would be worse. It also means the
-- last space standing is the one holding everything somebody has, and the
-- account with no space at all is the state 0014 exists to prevent. So one
-- space is marked `protected` and the database refuses to delete it, for the
-- same reason `profiles` has no delete path: it is not a preference.
--
-- Protected means exactly and only "cannot be deleted". It can be renamed,
-- recoloured, re-iconed, moved things into and out of, and shared with anybody
-- — the person whose space it is decides what it is *for*. What they cannot do
-- is end up with nowhere to write.
--
-- Enforced by a trigger rather than only by the policy, because the policy is
-- the *authenticated* caller's boundary and a definer function runs past it.
-- The trigger is on the table, so every path meets it.

alter table orbit.spaces
  add column if not exists protected boolean not null default false;

comment on column orbit.spaces.protected is
  'Cannot be deleted, by anybody, through any path. Set at creation only. '
  'Everything else about the space — name, colour, icon, membership — is ordinary.';

-- ---------------------------------------------------------------------------
-- The refusals.
-- ---------------------------------------------------------------------------
create or replace function app.refuse_protected_space_delete()
returns trigger
language plpgsql
as $$
begin
  if old.protected then
    raise exception
      using
        errcode = 'restrict_violation',
        message = format('“%s” cannot be deleted.', old.name),
        hint =
          'This is the space that guarantees you always have somewhere to write. '
          'It can be renamed, and anything in it can be moved elsewhere.';
  end if;
  return old;
end $$;

drop trigger if exists spaces_refuse_protected_delete on orbit.spaces;
create trigger spaces_refuse_protected_delete
  before delete on orbit.spaces
  for each row execute function app.refuse_protected_space_delete();

-- `protected` is set when the space is made and never afterwards. Both
-- directions are refused: turning it off would be a way to delete the space in
-- two statements instead of one, and turning it on would be a way to make
-- somebody else's space permanent. Nothing in the interface offers either.
create or replace function app.refuse_protected_space_change()
returns trigger
language plpgsql
as $$
begin
  if new.protected is distinct from old.protected then
    raise exception
      using
        errcode = 'restrict_violation',
        message = 'Whether a space can be deleted is fixed when it is created.';
  end if;
  return new;
end $$;

drop trigger if exists spaces_refuse_protected_change on orbit.spaces;
create trigger spaces_refuse_protected_change
  before update on orbit.spaces
  for each row execute function app.refuse_protected_space_change();

-- The policy says the same thing one layer up, so an ordinary delete matches no
-- row and reports nothing deleted, rather than raising. The trigger above is
-- what makes it true; this is what makes it *readable* from the outside.
drop policy if exists spaces_delete on orbit.spaces;
create policy spaces_delete on orbit.spaces for delete to authenticated
using (owner_id = auth.uid() and not protected);

-- ---------------------------------------------------------------------------
-- One place that makes a space.
--
-- 0014's `app.create_space()` did the two inserts itself. They move here so the
-- trigger below can make a space for a user who has no `auth.uid()` yet — it is
-- running *as* the insert into auth.users — without a second copy of the pair
-- that could drift from the first.
--
-- Internal: revoked from everybody. The two callers are definer functions in
-- this schema, and a function that takes an owner id and asks nothing is not
-- one to hand out.
-- ---------------------------------------------------------------------------
create or replace function app.new_space(
  p_owner       uuid,
  p_name        text,
  p_short_label text,
  p_kind        text,
  p_colour      text,
  p_icon        text,
  p_protected   boolean default false,
  p_default     boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = orbit, public, pg_temp
as $$
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_label text := btrim(coalesce(p_short_label, ''));
  v_kind  app.space_kind;
  v_id    uuid;
begin
  if v_name = '' then
    raise exception 'A space needs a name.' using errcode = 'check_violation';
  end if;
  v_name := left(v_name, 80);

  if v_label = '' then v_label := v_name; end if;
  v_label := left(v_label, 12);

  begin
    v_kind := coalesce(nullif(btrim(p_kind), ''), 'personal')::app.space_kind;
  exception when invalid_text_representation then
    raise exception 'Unknown space kind %.', p_kind using errcode = 'check_violation';
  end;

  insert into orbit.spaces
    (owner_id, name, kind, short_label, colour, icon, is_default, protected)
  values (
    p_owner, v_name, v_kind, v_label,
    coalesce(nullif(btrim(p_colour), ''), 'slate'),
    coalesce(nullif(btrim(p_icon), ''), 'circle'),
    p_default, coalesce(p_protected, false)
  )
  returning id into v_id;

  insert into orbit.space_members (space_id, user_id, role, status)
  values (v_id, p_owner, 'owner', 'active');

  return v_id;
end $$;

revoke execute on function
  app.new_space(uuid, text, text, text, text, text, boolean, boolean) from public;

-- 0014's function, now a thin caller. Its contract is unchanged: signed-in
-- only, owned by `auth.uid()`, never protected — the interface has no way to
-- make a second undeletable space and should not.
create or replace function app.create_space(
  p_name        text,
  p_short_label text default null,
  p_kind        text default 'personal',
  p_colour      text default 'slate',
  p_icon        text default 'circle'
)
returns uuid
language plpgsql
security definer
set search_path = orbit, public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_first boolean;
begin
  if v_uid is null then
    raise exception 'You have to be signed in to create a space.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from orbit.profiles p where p.id = v_uid) then
    raise exception 'There is no profile for the signed-in account (%).', v_uid
      using errcode = 'foreign_key_violation';
  end if;

  v_first := not exists (
    select 1 from orbit.space_members m
    where m.user_id = v_uid and m.status = 'active'
  );

  return app.new_space(
    v_uid, p_name, p_short_label, p_kind, p_colour, p_icon, false, v_first);
end $$;

revoke execute on function app.create_space(text, text, text, text, text) from public;
grant execute on function app.create_space(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The two spaces.
--
-- Idempotent on membership, not on names: it does nothing at all for somebody
-- who is already in a space, including somebody who deleted Work and is left
-- with Personal, and somebody who was invited into a household and has never
-- made one of their own. "Has no space" is the condition, because "has no space
-- called Work" would recreate a space somebody deliberately deleted.
-- ---------------------------------------------------------------------------
create or replace function app.provision_default_spaces(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = orbit, public, pg_temp
as $$
begin
  if p_user is null then return 0; end if;

  if not exists (select 1 from orbit.profiles p where p.id = p_user) then
    return 0;
  end if;

  if exists (
    select 1 from orbit.space_members m
    where m.user_id = p_user and m.status = 'active'
  ) then
    return 0;
  end if;

  -- Personal first, so it is the one `listSpaces` orders to the top and every
  -- compose surface preselects. It is also the protected one: the guarantee is
  -- "you always have somewhere to write", and the place to write by default is
  -- the place that cannot go away.
  perform app.new_space(p_user, 'Personal', 'Personal', 'personal', 'indigo', 'user', true, true);
  perform app.new_space(p_user, 'Work', 'Work', 'work', 'sky', 'briefcase', false, false);

  return 2;
end $$;

revoke execute on function app.provision_default_spaces(uuid) from public;

-- The signed-in caller's own version, and the only one anybody may call. It
-- takes no argument, so it cannot be pointed at somebody else.
create or replace function app.ensure_default_spaces()
returns integer
language sql
security definer
set search_path = orbit, public, pg_temp
as $$
  select app.provision_default_spaces(auth.uid())
$$;

revoke execute on function app.ensure_default_spaces() from public;
grant execute on function app.ensure_default_spaces() to authenticated;

-- ---------------------------------------------------------------------------
-- Signing up gets you both, without the application being involved.
--
-- 0012's trigger function, replaced so the spaces are made in the same
-- transaction as the profile. One trigger rather than two: a second trigger on
-- the same event would depend on firing after this one, and "in alphabetical
-- order of trigger name" is a true fact about Postgres that nobody should have
-- to know to read this file.
--
-- Everything above the provisioning call is 0012's, unchanged.
-- ---------------------------------------------------------------------------
create or replace function app.profile_for_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = orbit, public, pg_temp
as $$
declare
  v_email text;
  v_name  text;
  v_clash uuid;
begin
  v_email := coalesce(nullif(btrim(new.email), ''), new.id::text || '@no-email.invalid');

  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'displayName'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(v_email, '@', 1), ''),
    v_email
  );

  -- A profile with this id already exists. Still ask for the spaces: a restored
  -- dump or a re-run migration can leave a profile behind without them, and the
  -- provisioning is a no-op for anybody who has one.
  if exists (select 1 from orbit.profiles p where p.id = new.id) then
    perform app.provision_default_spaces(new.id);
    return new;
  end if;

  select p.id into v_clash from orbit.profiles p where p.email = v_email;
  if v_clash is not null then
    raise exception
      using
        errcode = 'unique_violation',
        message = format(
          'A profile already exists with the email %s (profile %s), so the new account %s cannot be given one.',
          v_email, v_clash, new.id),
        hint =
          'Seeded profiles are development data and a real deployment starts empty. '
          'Either sign up with a different address, or delete the seeded profile that holds this one.';
  end if;

  insert into orbit.profiles (id, email, display_name)
  values (new.id, v_email, left(v_name, 120));

  perform app.provision_default_spaces(new.id);

  return new;
end $$;

revoke execute on function app.profile_for_new_auth_user() from public;

-- ---------------------------------------------------------------------------
-- Everybody who is already here.
--
-- A profile with no space is the state this migration exists to end, and there
-- may be some already — including any account created between 0012 and now. The
-- trigger only fires for new sign-ups, so the existing ones are provisioned
-- once, here.
--
-- Seeded profiles have spaces and are skipped by the membership check.
-- ---------------------------------------------------------------------------
do $$
declare
  v_user uuid;
  v_made integer := 0;
begin
  for v_user in
    select p.id
    from orbit.profiles p
    where not exists (
      select 1 from orbit.space_members m
      where m.user_id = p.id and m.status = 'active'
    )
  loop
    v_made := v_made + app.provision_default_spaces(v_user);
  end loop;

  if v_made > 0 then
    raise notice 'Provisioned % default spaces for accounts that had none.', v_made;
  end if;
end $$;
