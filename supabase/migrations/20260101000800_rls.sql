-- ============================================================================
-- Orbit 0008 — apply RLS uniformly, then override only where the uniform rule
-- is not strict enough. There is no table where it is loosened.
-- ============================================================================

-- Shareable units (may also be reached via an ad-hoc `shares` row).
select app.apply_standard_rls('people',        'person');
select app.apply_standard_rls('groups',        'group');
select app.apply_standard_rls('events',        'event');
select app.apply_standard_rls('tasks',         'task');
select app.apply_standard_rls('notes',         'note');
select app.apply_standard_rls('places',        'place');
select app.apply_standard_rls('projects',      'project');
select app.apply_standard_rls('interactions',  'interaction');
select app.apply_standard_rls('talking_points','talking_point');
select app.apply_standard_rls('attachments',   'attachment');
select app.apply_standard_rls('saved_filters', 'saved_filter');

-- Child and junction rows: space check only, never independently shareable.
select app.apply_standard_rls('tags');
select app.apply_standard_rls('person_fields');
select app.apply_standard_rls('person_dates');
select app.apply_standard_rls('person_state');
select app.apply_standard_rls('person_relations');
select app.apply_standard_rls('addresses');
select app.apply_standard_rls('categories');
select app.apply_standard_rls('calendars');
select app.apply_standard_rls('event_occurrences');
select app.apply_standard_rls('category_rules');
select app.apply_standard_rls('task_contexts');
select app.apply_standard_rls('note_embeddings');
select app.apply_standard_rls('import_batches');
select app.apply_standard_rls('integrations');
select app.apply_standard_rls('notification_prefs');
select app.apply_standard_rls('devices');
select app.apply_standard_rls('travel_profiles');
select app.apply_standard_rls('travel_time_cache');
select app.apply_standard_rls('note_updates');
select app.apply_standard_rls('links');
select app.apply_standard_rls('taggings');
select app.apply_standard_rls('group_members');
select app.apply_standard_rls('event_attendees');

-- ----------------------------------------------------------------------------
-- Overrides: both-endpoints-visible for anything joining two entities.
--
-- Dropping the generated SELECT policy and replacing it is deliberate — the
-- generated one keys on a single space_id, which is not sufficient for a row
-- that spans two.
-- ----------------------------------------------------------------------------

drop policy links_select on links;
create policy links_select on links for select to authenticated
using (
  deleted_at is null
  and (source_space_id = any(app.readable_space_ids())
       or app.has_share(source_type, source_id, 'view'))
  and (target_space_id = any(app.readable_space_ids())
       or app.has_share(target_type, target_id, 'view'))
);

drop policy links_update on links;
create policy links_update on links for update to authenticated
using (
  source_space_id = any(app.writable_space_ids())
  and target_space_id = any(app.writable_space_ids())
)
with check (
  source_space_id = any(app.writable_space_ids())
  and target_space_id = any(app.writable_space_ids())
);

drop policy taggings_select on taggings;
create policy taggings_select on taggings for select to authenticated
using (
  deleted_at is null
  and entity_space_id = any(app.readable_space_ids())
  and tag_space_id    = any(app.readable_space_ids())
);

drop policy group_members_select on group_members;
create policy group_members_select on group_members for select to authenticated
using (
  deleted_at is null
  and person_space_id = any(app.readable_space_ids())
  and group_space_id  = any(app.readable_space_ids())
);

-- An attendee row is visible when the event is. If the attendee is also a
-- Person I cannot see, person_id is masked by the client-facing view below
-- rather than hiding the attendee entirely — the event legitimately has an
-- attendee; what must not leak is that they exist in someone's private space.
drop policy event_attendees_select on event_attendees;
create policy event_attendees_select on event_attendees for select to authenticated
using (
  deleted_at is null
  and event_space_id = any(app.readable_space_ids())
);

create view public.event_attendees_visible
with (security_invoker = on) as
  select a.id, a.event_id, a.event_space_id, a.external_email, a.display_name,
         a.response_status, a.is_organiser,
         case when a.person_space_id = any(app.readable_space_ids())
              then a.person_id end as person_id
  from event_attendees a;
grant select on public.event_attendees_visible to authenticated;

-- ----------------------------------------------------------------------------
-- Per-member private rows: belt and braces on top of the personal-space rule.
-- If a bug ever put one of these in a shared space, the user_id predicate still
-- holds the line.
-- ----------------------------------------------------------------------------

drop policy person_state_select on person_state;
create policy person_state_select on person_state for select to authenticated
using (deleted_at is null
       and user_id = (select auth.uid())
       and space_id = any(app.readable_space_ids()));

drop policy person_state_insert on person_state;
create policy person_state_insert on person_state for insert to authenticated
with check (user_id = (select auth.uid())
            and owner_id = (select auth.uid())
            and space_id = any(app.writable_space_ids()));

drop policy person_state_update on person_state;
create policy person_state_update on person_state for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy devices_select on devices;
create policy devices_select on devices for select to authenticated
using (user_id = (select auth.uid()));

drop policy notification_prefs_select on notification_prefs;
create policy notification_prefs_select on notification_prefs for select to authenticated
using (user_id = (select auth.uid()));

drop policy travel_profiles_select on travel_profiles;
create policy travel_profiles_select on travel_profiles for select to authenticated
using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Attach the propagation + sensitivity triggers now that every table exists.
-- ----------------------------------------------------------------------------

create trigger people_space_change  after update of space_id on people
  for each row execute function app.propagate_space_change('person');
create trigger groups_space_change  after update of space_id on groups
  for each row execute function app.propagate_space_change('group');
create trigger events_space_change  after update of space_id on events
  for each row execute function app.propagate_space_change('event');
create trigger tasks_space_change   after update of space_id on tasks
  for each row execute function app.propagate_space_change('task');
create trigger notes_space_change   after update of space_id on notes
  for each row execute function app.propagate_space_change('note');
create trigger places_space_change  after update of space_id on places
  for each row execute function app.propagate_space_change('place');
create trigger projects_space_change after update of space_id on projects
  for each row execute function app.propagate_space_change('project');

create trigger notes_guard_share  before update of space_id on notes
  for each row execute function app.guard_sensitive_space_move();
create trigger people_guard_share before update of space_id on person_state
  for each row execute function app.guard_sensitive_space_move();
create trigger fields_guard_share before update of space_id on person_fields
  for each row execute function app.guard_sensitive_space_move();

-- ----------------------------------------------------------------------------
-- Garbage-collect graph edges when an endpoint is soft-deleted, so a deleted
-- private note cannot leave a dangling edge that survives into a shared view.
-- ----------------------------------------------------------------------------

create or replace function app.cascade_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare et entity_type := tg_argv[0]::entity_type;
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update links    set deleted_at = new.deleted_at
      where (source_type = et and source_id = new.id) or (target_type = et and target_id = new.id);
    update taggings set deleted_at = new.deleted_at
      where entity_type = et and entity_id = new.id;
    update attachments set deleted_at = new.deleted_at
      where entity_type = et and entity_id = new.id;
  end if;
  return new;
end;
$$;

create trigger people_soft_delete after update of deleted_at on people
  for each row execute function app.cascade_soft_delete('person');
create trigger notes_soft_delete  after update of deleted_at on notes
  for each row execute function app.cascade_soft_delete('note');
create trigger tasks_soft_delete  after update of deleted_at on tasks
  for each row execute function app.cascade_soft_delete('task');
create trigger events_soft_delete after update of deleted_at on events
  for each row execute function app.cascade_soft_delete('event');
create trigger places_soft_delete after update of deleted_at on places
  for each row execute function app.cascade_soft_delete('place');
create trigger groups_soft_delete after update of deleted_at on groups
  for each row execute function app.cascade_soft_delete('group');
