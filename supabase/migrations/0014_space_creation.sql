-- 0014_space_creation.sql — how somebody gets their first space.
--
-- Until this migration a real account could sign up and then do nothing at all.
-- 0012 gives every new auth user a profile, but a profile owns nothing: every
-- space-scoped table takes a `space_id`, capture refuses to write without one,
-- and the only route into a space was an invitation from somebody who already
-- had one. A deployment whose first user cannot create anything is a deployment
-- with no first user.
--
-- The policies genuinely cannot express this, for the same reason redeeming an
-- invite needed a definer function in 0012:
--
--   * `spaces_insert` lets you insert a space you own — that part is fine.
--   * `space_members_insert` requires `app.is_space_admin(space_id)`, and a
--     space created one statement ago has no members, so its own creator is not
--     an admin of it. The insert that would make them one is the insert being
--     refused.
--
-- So the space exists and nobody, including its owner, is in it. Widening
-- `space_members_insert` to "or you own the space" would work and is the wrong
-- fix: `owner_id` is a column an insert chooses, so that policy would let
-- anybody add themselves to any space they could name as owner. Instead, one
-- SECURITY DEFINER function that does both writes together, for `auth.uid()`
-- and nobody else.
--
-- What it will not do:
--   * it never writes for a caller who is not signed in
--   * it only ever creates a space owned by `auth.uid()`, ignoring any owner a
--     caller might like to name — there is no parameter for it
--   * it only ever adds `auth.uid()` as the member, as `owner`
--   * it does not touch any other space, and it grants nothing anywhere else

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
  v_name  text := btrim(coalesce(p_name, ''));
  v_label text := btrim(coalesce(p_short_label, ''));
  v_kind  app.space_kind;
  v_first boolean;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'You have to be signed in to create a space.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The profile is created by the trigger in 0012, so its absence means the two
  -- halves of identity have come apart. Say which half rather than failing on a
  -- foreign key.
  if not exists (select 1 from orbit.profiles p where p.id = v_uid) then
    raise exception 'There is no profile for the signed-in account (%).', v_uid
      using errcode = 'foreign_key_violation';
  end if;

  if v_name = '' then
    raise exception 'A space needs a name.' using errcode = 'check_violation';
  end if;
  v_name := left(v_name, 80);

  -- `spaces_short_label_len` is 1..12 and the indicator renders this on every
  -- row, so a name longer than the chip is trimmed rather than refused: the
  -- short label is a convenience, not a second thing to fill in.
  if v_label = '' then v_label := v_name; end if;
  v_label := left(v_label, 12);

  begin
    v_kind := coalesce(nullif(btrim(p_kind), ''), 'personal')::app.space_kind;
  exception when invalid_text_representation then
    raise exception 'Unknown space kind %.', p_kind using errcode = 'check_violation';
  end;

  -- The first space somebody has is their default: `listSpaces` orders by
  -- `is_default desc`, so this is what capture and every compose surface
  -- preselect. Later ones are not, because "default" is a choice and creating a
  -- second space is not making it.
  v_first := not exists (
    select 1 from orbit.space_members m
    where m.user_id = v_uid and m.status = 'active'
  );

  insert into orbit.spaces (owner_id, name, kind, short_label, colour, icon, is_default)
  values (v_uid, v_name, v_kind, v_label, coalesce(nullif(btrim(p_colour), ''), 'slate'),
          coalesce(nullif(btrim(p_icon), ''), 'circle'), v_first)
  returning id into v_id;

  insert into orbit.space_members (space_id, user_id, role, status)
  values (v_id, v_uid, 'owner', 'active');

  return v_id;
end $$;

-- Narrow, like every other definer function here: nobody holds it by default
-- and the only role granted it is the one the application acts as.
revoke execute on function app.create_space(text, text, text, text, text) from public;
grant execute on function app.create_space(text, text, text, text, text) to authenticated;
