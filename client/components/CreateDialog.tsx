import { useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, FilePlus2, ListPlus, MapPin, UserRoundPlus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { createEvent, createNote, createPerson, createPlace, createTask } from '../data/api';
import { useProfile, useSpaces } from '../data/hooks';
import { addDays, isoDate, startOfDay } from '../lib/date';
import s from '../styles/ui.module.css';

type Kind = 'task' | 'event' | 'person' | 'note' | 'place';
const kinds: { id: Kind; label: string; icon: typeof ListPlus }[] = [
  { id: 'task', label: 'Task', icon: ListPlus }, { id: 'event', label: 'Event', icon: CalendarPlus }, { id: 'person', label: 'Person', icon: UserRoundPlus }, { id: 'note', label: 'Note', icon: FilePlus2 }, { id: 'place', label: 'Place', icon: MapPin },
];

export function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<Kind>('task');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const spaces = useSpaces();
  const profile = useProfile();
  const auth = useAuth();
  const client = useQueryClient();
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  const defaultSpace = profile.data?.default_space_id ?? spaces.data?.find((space) => space.is_default)?.id ?? spaces.data?.[0]?.id ?? '';
  return <dialog ref={dialog} className={s.dialog} onClose={onClose} onCancel={onClose}>
    <form className={s.form} method="dialog" onSubmit={async (event) => {
      event.preventDefault(); setError(''); setSaving(true);
      const data = new FormData(event.currentTarget);
      const title = String(data.get('title') ?? '').trim(); const space_id = String(data.get('space_id') ?? defaultSpace);
      if (!title || !space_id || !auth.user) { setError('A title and space are required.'); setSaving(false); return; }
      try {
        if (kind === 'task') await createTask({ title, space_id, owner_id: auth.user.id, due_on: String(data.get('date') || '') || null });
        if (kind === 'event') {
          const date = String(data.get('date') || isoDate(new Date()));
          const starts = new Date(`${date}T09:00:00`); const ends = new Date(starts); ends.setHours(10);
          await createEvent({ title, space_id, owner_id: auth.user.id, starts_at: starts.toISOString(), ends_at: ends.toISOString() });
        }
        if (kind === 'person') await createPerson({ display_name: title, space_id, owner_id: auth.user.id });
        if (kind === 'note') await createNote({ title, body_md: '', space_id, owner_id: auth.user.id });
        if (kind === 'place') await createPlace({ name: title, space_id, owner_id: auth.user.id });
        await client.invalidateQueries(); event.currentTarget.reset(); onClose();
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create this item.'); }
      finally { setSaving(false); }
    }}>
      <div className={s.dialogBody}>
        <div className={s.pageHeader}><div><h2>Create</h2><p className={s.muted}>Add something without losing your place.</p></div><button type="button" className={s.iconButton} onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className={s.segments} aria-label="Item type">{kinds.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={`${s.segButton} ${kind === id ? s.segActive : ''}`} aria-pressed={kind === id} onClick={() => setKind(id)}><Icon size={17} />{label}</button>)}</div>
        <div className={s.field}><label htmlFor="create-title">{kind === 'person' ? 'Name' : 'Title'}</label><input id="create-title" className={s.input} name="title" autoFocus maxLength={200} /></div>
        <div className={s.field}><label htmlFor="create-space">Space</label><select id="create-space" className={s.select} name="space_id" defaultValue={defaultSpace}>{spaces.data?.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></div>
        {(kind === 'task' || kind === 'event') && <div className={s.field}><label htmlFor="create-date">Date</label><input id="create-date" className={s.input} type="date" name="date" min={isoDate(startOfDay(new Date()))} max={isoDate(addDays(new Date(), 3650))} /></div>}
        {error && <div className={s.error} role="alert">{error}</div>}
      </div>
      <div className={s.dialogActions}><button type="button" className={s.secondaryButton} onClick={onClose}>Cancel</button><button className={s.primaryButton} disabled={saving}>{saving ? 'Creating…' : `Create ${kind}`}</button></div>
    </form>
  </dialog>;
}
