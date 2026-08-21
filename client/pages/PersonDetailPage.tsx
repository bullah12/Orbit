import { ArrowLeft, CalendarDays, Mail, MapPin, Phone } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { AsyncState } from '../components/AsyncState';
import { PageHeader } from '../components/AppShell';
import { addPersonContact, addPersonDate, getPerson, listPlaces, updatePerson } from '../data/api';
import { queryKeys } from '../data/queryKeys';
import { formatShortDate } from '../lib/date';
import s from '../styles/ui.module.css';

export default function PersonDetailPage() {
  const { id = '' } = useParams(); const client = useQueryClient(); const [status, setStatus] = useState('');
  const person = useQuery({ queryKey: queryKeys.person(id), queryFn: () => getPerson(id), enabled: Boolean(id) });
  const places = useQuery({ queryKey: queryKeys.places(''), queryFn: () => listPlaces(), staleTime: 5 * 60_000 });
  const record = person.data?.person; const home = places.data?.find((place) => place.id === record?.home_place_id);
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.person(id) });
  return <>
    <PageHeader title={record?.is_locked ? 'Locked person' : record?.display_name ?? 'Person'} subtitle={record?.pronouns ?? undefined} actions={<Link className={s.secondaryButton} to="/people"><ArrowLeft size={18} />People</Link>} />
    <AsyncState loading={person.isLoading} error={person.error} retry={() => void person.refetch()}>
      {record?.is_locked ? <div className={s.card}>This encrypted record is unavailable in this release.</div> : record && <>
        <div className={`${s.grid} ${s.todayGrid}`}>
          <section className={s.card}><h2>Contact</h2>{person.data?.contacts.length ? <ul className={s.list}>{person.data.contacts.map((contact) => <li className={s.row} key={contact.id}>{contact.kind === 'email' ? <Mail size={18} /> : contact.kind === 'phone' ? <Phone size={18} /> : <MapPin size={18} />}<div className={s.rowMain}><span className={s.rowTitle}>{contact.value}</span><span className={s.rowMeta}>{contact.label}{contact.is_primary && ' · Primary'}</span></div></li>)}</ul> : <p className={s.muted}>No contact details yet.</p>}
            <form className={s.form} onSubmit={async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); await addPersonContact(record, { kind: String(data.get('kind')), label: String(data.get('label')), value: String(data.get('value')) }); event.currentTarget.reset(); await refresh(); }}><div className={s.toolbar}><select className={s.select} style={{ width: 'auto' }} name="kind"><option value="email">Email</option><option value="phone">Phone</option><option value="address">Address</option><option value="url">URL</option><option value="handle">Handle</option></select><input className={s.input} style={{ maxWidth: 140 }} name="label" placeholder="Label" defaultValue="other" /><input className={s.input} name="value" placeholder="Contact detail" required /><button className={s.secondaryButton}>Add</button></div></form>
            <h2 style={{ marginTop: '1.5rem' }}>Home place</h2>{home ? <Link className={s.row} to={`/places/${home.id}`}><MapPin size={18} /><span>{home.name}</span></Link> : <p className={s.muted}>No home place recorded.</p>}
            <label className={s.field}><span className={s.label}>Set home place</span><select className={s.select} value={record.home_place_id ?? ''} onChange={async (event) => { setStatus('Saving…'); await updatePerson(record.id, { home_place_id: event.target.value || null }); await refresh(); setStatus('Saved'); }}><option value="">No home place</option>{places.data?.filter((place) => place.space_id === record.space_id).map((place) => <option value={place.id} key={place.id}>{place.name}</option>)}</select></label>
            <h2 style={{ marginTop: '1.5rem' }}>Notes</h2><p>{record.notes_md || 'No notes yet.'}</p>
          </section>
          <section className={s.card}><h2>Important dates</h2>{person.data?.dates.length ? <ul className={s.list}>{person.data.dates.map((date) => <li className={s.row} key={date.id}><CalendarDays size={18} /><div className={s.rowMain}><span className={s.rowTitle}>{date.label || date.kind}</span><span className={s.rowMeta}>{date.year_known ? formatShortDate(date.on_date) : date.on_date.slice(5)}</span></div></li>)}</ul> : <p className={s.muted}>No important dates recorded.</p>}
            <form className={s.form} onSubmit={async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); await addPersonDate(record, { kind: String(data.get('kind')), label: String(data.get('label')) || null, on_date: String(data.get('on_date')), year_known: data.get('year_known') === 'on' }); event.currentTarget.reset(); await refresh(); }}><div className={s.toolbar}><select className={s.select} style={{ width: 'auto' }} name="kind"><option value="birthday">Birthday</option><option value="anniversary">Anniversary</option><option value="met_on">Met on</option><option value="other">Other</option></select><input className={s.input} name="label" placeholder="Optional label" /><input className={s.input} type="date" name="on_date" required /><label><input type="checkbox" name="year_known" defaultChecked /> Year known</label><button className={s.secondaryButton}>Add</button></div></form>
            <h2 style={{ marginTop: '1.5rem' }}>Linked events</h2>{person.data?.events.length ? <ul className={s.list}>{person.data.events.map((event) => <li className={s.row} key={event.id}><div className={s.rowMain}><span className={s.rowTitle}>{event.title}</span><span className={s.rowMeta}>{formatShortDate(event.starts_at)}</span></div></li>)}</ul> : <p className={s.muted}>No linked events.</p>}
          </section>
        </div>{status && <p className={s.success} role="status">{status}</p>}
      </>}
    </AsyncState>
  </>;
}
