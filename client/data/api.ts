import { orbitApi, supabase } from '../lib/supabase';
import { addDays, isoDate, startOfDay } from '../lib/date';
import type { ChecklistItem, Event, Member, Note, Person, PersonContact, PersonDate, Place, Profile, SearchResult, Space, Task } from './types';

function value<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error('The requested record was not returned.');
  return data;
}

export async function getProfile(id: string): Promise<Profile> {
  const result = await supabase.from('profiles').select('*').eq('id', id).single();
  return value(result.data as Profile | null, result.error);
}

export async function updateProfile(id: string, changes: Partial<Pick<Profile, 'display_name' | 'theme' | 'week_starts_on' | 'default_space_id'>>): Promise<Profile> {
  const result = await supabase.from('profiles').update(changes).eq('id', id).select('*').single();
  return value(result.data as Profile | null, result.error);
}

export async function listSpaces(): Promise<Space[]> {
  const result = await supabase.from('spaces').select('*, space_members(user_id,role)').is('archived_at', null).order('is_default', { ascending: false }).order('name');
  return value((result.data ?? []) as unknown as Space[], result.error);
}

export async function createSpace(name: string): Promise<string> {
  const result = await orbitApi.rpc('create_space', { p_name: name });
  return value(result.data as string | null, result.error);
}

export async function renameSpace(id: string, name: string): Promise<void> {
  const result = await supabase.from('spaces').update({ name, short_label: name.slice(0, 12) }).eq('id', id);
  if (result.error) throw new Error(result.error.message);
}

export async function listMembers(spaceId: string): Promise<Member[]> {
  const result = await supabase.from('space_members').select('*, profiles:user_id(*)').eq('space_id', spaceId).eq('status', 'active').order('joined_at');
  return value((result.data ?? []) as unknown as Member[], result.error);
}

export async function createInvite(spaceId: string, ownerId: string, role: Member['role'], invitedEmail?: string): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const result = await supabase.from('space_invites').insert({ space_id: spaceId, owner_id: ownerId, token_hash: tokenHash, role, invited_email: invitedEmail || null });
  if (result.error) throw new Error(result.error.message);
  return token;
}

export async function inviteAction(token: string, action: 'preview' | 'accept' | 'decline'): Promise<Record<string, unknown>> {
  const result = await orbitApi.rpc(`invite_${action}`, { p_token: token });
  return value(result.data as Record<string, unknown> | null, result.error);
}

export type TaskFilter = 'mine' | 'today' | 'upcoming' | 'inbox' | 'waiting' | 'someday' | 'done' | 'all';

export async function listTasks(filter: TaskFilter, spaceId = '', assigneeId = '', userId = ''): Promise<Task[]> {
  let query = supabase.from('tasks').select('*').order('sort_order').order('due_on', { nullsFirst: false }).order('updated_at', { ascending: false });
  if (spaceId) query = query.eq('space_id', spaceId);
  if (assigneeId) query = query.eq('assignee_id', assigneeId);
  const today = isoDate(new Date());
  const tomorrow = isoDate(addDays(new Date(), 1));
  const fortnight = isoDate(addDays(new Date(), 14));
  switch (filter) {
    case 'mine': query = query.eq('assignee_id', userId).in('status', ['todo', 'doing', 'blocked']); break;
    case 'today': query = query.lte('due_on', today).in('status', ['todo', 'doing', 'blocked']); break;
    case 'upcoming': query = query.gte('due_on', tomorrow).lte('due_on', fortnight).in('status', ['todo', 'doing', 'blocked']); break;
    case 'inbox': query = query.is('due_on', null).is('deferred_until', null).eq('status', 'todo'); break;
    case 'waiting': query = query.eq('status', 'blocked'); break;
    case 'someday': query = query.gt('deferred_until', new Date().toISOString()).neq('status', 'done'); break;
    case 'done': query = query.eq('status', 'done'); break;
    case 'all': break;
  }
  const result = await query.limit(250);
  return value((result.data ?? []) as Task[], result.error);
}

export async function getTask(id: string): Promise<{ task: Task; checklist: ChecklistItem[] }> {
  const [task, checklist] = await Promise.all([
    supabase.from('tasks').select('*, recurrence_rules:recurrence_rule_id(*)').eq('id', id).single(),
    supabase.from('task_checklist_items').select('*').eq('task_id', id).order('sort_order'),
  ]);
  return { task: value(task.data as Task | null, task.error), checklist: value((checklist.data ?? []) as ChecklistItem[], checklist.error) };
}

export async function createTask(input: Pick<Task, 'space_id' | 'owner_id' | 'title'> & Partial<Task>): Promise<Task> {
  const result = await supabase.from('tasks').insert(input).select('*').single();
  return value(result.data as Task | null, result.error);
}

export async function updateTask(id: string, changes: Partial<Task>): Promise<Task> {
  const result = await supabase.from('tasks').update(changes).eq('id', id).select('*').single();
  return value(result.data as Task | null, result.error);
}

export async function toggleTask(task: Task): Promise<Task> {
  const done = task.status !== 'done';
  return updateTask(task.id, { status: done ? 'done' : 'todo', completed_at: done ? new Date().toISOString() : null });
}

export async function addChecklistItem(task: Task, label: string, sortOrder: number): Promise<ChecklistItem> {
  const result = await supabase.from('task_checklist_items').insert({ task_id: task.id, space_id: task.space_id, owner_id: task.owner_id, label, sort_order: sortOrder }).select('*').single();
  return value(result.data as ChecklistItem | null, result.error);
}

export async function updateChecklistItem(id: string, done: boolean): Promise<void> {
  const result = await supabase.from('task_checklist_items').update({ done }).eq('id', id);
  if (result.error) throw new Error(result.error.message);
}

export async function setTaskRecurrence(task: Task, rrule: string): Promise<void> {
  if ((task.recurrence_rules?.rrule ?? '') === rrule) return;
  if (!rrule) {
    const result = await supabase.from('tasks').update({ recurrence_rule_id: null }).eq('id', task.id);
    if (result.error) throw new Error(result.error.message);
    return;
  }
  const starts = task.due_at ?? `${task.due_on ?? isoDate(new Date())}T09:00:00.000Z`;
  if (task.recurrence_rule_id) {
    const updated = await supabase.from('recurrence_rules').update({ rrule, dtstart: starts, space_id: task.space_id }).eq('id', task.recurrence_rule_id).select('id').single();
    value(updated.data as { id: string } | null, updated.error);
    return;
  }
  const created = await supabase.from('recurrence_rules').insert({ space_id: task.space_id, owner_id: task.owner_id, rrule, dtstart: starts }).select('id').single();
  const rule = value(created.data as { id: string } | null, created.error);
  const linked = await supabase.from('tasks').update({ recurrence_rule_id: rule.id }).eq('id', task.id);
  if (linked.error) throw new Error(linked.error.message);
}

export type TodayData = { tasks: Task[]; events: Event[]; dates: (PersonDate & { people?: Pick<Person, 'display_name'> | null })[] };
export async function getToday(range: number): Promise<TodayData> {
  const start = startOfDay(new Date());
  const end = addDays(start, range);
  const result = await orbitApi.rpc('dashboard', { p_from: start.toISOString(), p_to: end.toISOString() });
  return value(result.data as TodayData | null, result.error);
}

export async function listEvents(from: Date, to: Date, freeBusySpaceIds: string[] = []): Promise<Event[]> {
  const result = await supabase.from('events').select('*, recurrence_rules:recurrence_rule_id(*)').lt('starts_at', to.toISOString()).neq('status', 'cancelled').order('starts_at').limit(500);
  const rows = value((result.data ?? []) as unknown as Event[], result.error);
  const anonymous = await Promise.all(freeBusySpaceIds.flatMap((spaceId) => [
    orbitApi.rpc('free_busy_blocks', { p_space_id: spaceId, p_from: from.toISOString(), p_to: to.toISOString() }),
    orbitApi.rpc('free_busy_recurring', { p_space_id: spaceId, p_from: from.toISOString(), p_to: to.toISOString() }),
  ]));
  const busy: Event[] = anonymous.flatMap((response, responseIndex) => {
    if (response.error) throw new Error(response.error.message);
    const spaceId = freeBusySpaceIds[Math.floor(responseIndex / 2)] ?? '';
    return ((response.data ?? []) as Record<string, unknown>[]).map((item, index) => ({
      id: `busy-${spaceId}-${responseIndex}-${index}`, space_id: spaceId, owner_id: '', title: 'Busy', body_md: '', location_text: null, place_id: null,
      starts_at: String(item.starts_at), ends_at: String(item.ends_at), all_day: Boolean(item.all_day), timezone: 'Europe/London', status: 'confirmed', visibility: 'private', is_locked: false,
      recurrence_rule_id: item.rrule ? `busy-rule-${spaceId}-${responseIndex}-${index}` : null,
      recurrence_rules: item.rrule ? { id: `busy-rule-${spaceId}-${responseIndex}-${index}`, rrule: String(item.rrule), dtstart: String(item.starts_at), until: item.rule_until ? String(item.rule_until) : null, timezone: 'Europe/London', exdates: (item.exdates as string[] | undefined) ?? [] } : null,
    }));
  });
  return [...rows.filter((event) => event.recurrence_rule_id || new Date(event.ends_at) > from), ...busy];
}

export async function createEvent(input: Pick<Event, 'space_id' | 'owner_id' | 'title' | 'starts_at' | 'ends_at'> & Partial<Event>): Promise<Event> {
  const result = await supabase.from('events').insert(input).select('*').single();
  return value(result.data as Event | null, result.error);
}

export async function updateEvent(id: string, changes: Partial<Event>): Promise<Event> {
  const result = await supabase.from('events').update(changes).eq('id', id).select('*').single();
  return value(result.data as Event | null, result.error);
}

export async function setEventRecurrence(event: Event, rrule: string): Promise<void> {
  if ((event.recurrence_rules?.rrule ?? '') === rrule) return;
  if (!rrule) {
    const result = await supabase.from('events').update({ recurrence_rule_id: null }).eq('id', event.id);
    if (result.error) throw new Error(result.error.message);
    return;
  }
  if (event.recurrence_rule_id) {
    const updated = await supabase.from('recurrence_rules').update({ rrule, dtstart: event.starts_at, timezone: event.timezone, space_id: event.space_id }).eq('id', event.recurrence_rule_id).select('id').single();
    value(updated.data as { id: string } | null, updated.error);
    return;
  }
  const created = await supabase.from('recurrence_rules').insert({ space_id: event.space_id, owner_id: event.owner_id, rrule, dtstart: event.starts_at, timezone: event.timezone }).select('id').single();
  const rule = value(created.data as { id: string } | null, created.error);
  const linked = await supabase.from('events').update({ recurrence_rule_id: rule.id }).eq('id', event.id);
  if (linked.error) throw new Error(linked.error.message);
}

export async function listPeople(search = ''): Promise<Person[]> {
  let query = supabase.from('people').select('*').is('archived_at', null).order('display_name').limit(250);
  if (search.trim()) query = query.ilike('display_name', `%${search.trim()}%`);
  const result = await query;
  return value((result.data ?? []) as Person[], result.error);
}

export async function getPerson(id: string): Promise<{ person: Person; contacts: PersonContact[]; dates: PersonDate[]; events: Event[] }> {
  const [person, contacts, dates, attendees] = await Promise.all([
    supabase.from('people').select('*').eq('id', id).single(),
    supabase.from('person_contacts').select('*').eq('person_id', id).order('is_primary', { ascending: false }),
    supabase.from('person_dates').select('*').eq('person_id', id).order('on_date'),
    supabase.from('event_attendees').select('events:event_id(*)').eq('person_id', id).limit(50),
  ]);
  return { person: value(person.data as Person | null, person.error), contacts: value((contacts.data ?? []) as PersonContact[], contacts.error), dates: value((dates.data ?? []) as PersonDate[], dates.error), events: value((attendees.data ?? []).flatMap((row) => row.events ? [row.events as unknown as Event] : []), attendees.error) };
}

export async function createPerson(input: Pick<Person, 'space_id' | 'owner_id' | 'display_name'>): Promise<Person> {
  const result = await supabase.from('people').insert(input).select('*').single();
  return value(result.data as Person | null, result.error);
}

export async function updatePerson(id: string, changes: Partial<Person>): Promise<Person> {
  const result = await supabase.from('people').update(changes).eq('id', id).select('*').single();
  return value(result.data as Person | null, result.error);
}

export async function addPersonContact(person: Person, input: Pick<PersonContact, 'kind' | 'label' | 'value'>): Promise<void> {
  const result = await supabase.from('person_contacts').insert({ ...input, person_id: person.id, space_id: person.space_id, owner_id: person.owner_id });
  if (result.error) throw new Error(result.error.message);
}

export async function addPersonDate(person: Person, input: Pick<PersonDate, 'kind' | 'label' | 'on_date' | 'year_known'>): Promise<void> {
  const result = await supabase.from('person_dates').insert({ ...input, person_id: person.id, space_id: person.space_id, owner_id: person.owner_id });
  if (result.error) throw new Error(result.error.message);
}

export async function listPlaces(search = ''): Promise<Place[]> {
  let query = supabase.from('places').select('*').is('archived_at', null).order('name').limit(250);
  if (search.trim()) query = query.ilike('name', `%${search.trim()}%`);
  const result = await query;
  return value((result.data ?? []) as Place[], result.error);
}

export async function createPlace(input: Pick<Place, 'space_id' | 'owner_id' | 'name'> & Partial<Place>): Promise<Place> {
  const result = await supabase.from('places').insert(input).select('*').single();
  return value(result.data as Place | null, result.error);
}

export async function updatePlace(id: string, changes: Partial<Place>): Promise<Place> {
  const result = await supabase.from('places').update(changes).eq('id', id).select('*').single();
  return value(result.data as Place | null, result.error);
}

export async function listNotes(search = ''): Promise<Note[]> {
  let query = supabase.from('notes').select('*').is('archived_at', null).order('pinned_at', { ascending: false, nullsFirst: false }).order('updated_at', { ascending: false }).limit(250);
  if (search.trim()) query = query.or(`title.ilike.%${search.trim()}%,body_md.ilike.%${search.trim()}%`);
  const result = await query;
  return value((result.data ?? []) as Note[], result.error);
}

export async function getNote(id: string): Promise<Note> {
  const result = await supabase.from('notes').select('*').eq('id', id).single();
  return value(result.data as Note | null, result.error);
}

export async function createNote(input: Pick<Note, 'space_id' | 'owner_id'> & Partial<Note>): Promise<Note> {
  const result = await supabase.from('notes').insert(input).select('*').single();
  return value(result.data as Note | null, result.error);
}

export async function updateNote(id: string, changes: Partial<Note>): Promise<Note> {
  const result = await supabase.from('notes').update(changes).eq('id', id).select('*').single();
  return value(result.data as Note | null, result.error);
}

export async function linkNote(note: Note, entityKind: 'task' | 'person' | 'event' | 'place' | 'note', entityId: string): Promise<void> {
  const result = await supabase.from('note_links').insert({ note_id: note.id, space_id: note.space_id, owner_id: note.owner_id, entity_kind: entityKind, entity_id: entityId });
  if (result.error) throw new Error(result.error.message);
}

export async function globalSearch(query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const result = await orbitApi.rpc('search', { p_query: q, p_limit: 8 });
  return value((result.data ?? []) as SearchResult[], result.error);
}
