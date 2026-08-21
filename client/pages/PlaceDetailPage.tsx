import { ArrowLeft, MapPin } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { AsyncState } from '../components/AsyncState';
import { PageHeader } from '../components/AppShell';
import { listPlaces, updatePlace } from '../data/api';
import { queryKeys } from '../data/queryKeys';
import s from '../styles/ui.module.css';

export default function PlaceDetailPage() {
  const { id = '' } = useParams(); const client = useQueryClient(); const places = useQuery({ queryKey: queryKeys.places(''), queryFn: () => listPlaces() }); const place = places.data?.find((item) => item.id === id);
  return <><PageHeader title={place?.is_locked ? 'Locked place' : place?.name ?? 'Place'} actions={<Link className={s.secondaryButton} to="/places"><ArrowLeft size={18} />Places</Link>} /><AsyncState loading={places.isLoading} error={places.error}>{place ? <section className={s.card}>{place.is_locked ? <p>This encrypted place is unavailable in this release.</p> : <form className={s.form} onSubmit={async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); await updatePlace(place.id, { name: String(data.get('name')), address_text: String(data.get('address_text')) || null, city: String(data.get('city')) || null, postcode: String(data.get('postcode')) || null, notes_md: String(data.get('notes_md')) }); await client.invalidateQueries({ queryKey: ['places'] }); }}><MapPin size={24} /><div className={s.field}><label htmlFor="place-name">Name</label><input id="place-name" className={s.input} name="name" defaultValue={place.name} required /></div><div className={s.field}><label htmlFor="place-address">Address</label><input id="place-address" className={s.input} name="address_text" defaultValue={place.address_text ?? ''} /></div><div className={s.toolbar}><input className={s.input} name="city" aria-label="City" placeholder="City" defaultValue={place.city ?? ''} /><input className={s.input} name="postcode" aria-label="Postcode" placeholder="Postcode" defaultValue={place.postcode ?? ''} /></div><div className={s.field}><label htmlFor="place-notes">Notes</label><textarea id="place-notes" className={s.textarea} name="notes_md" defaultValue={place.notes_md} /></div><button className={s.primaryButton}>Save place</button></form>}</section> : <div className={s.empty}>This place is unavailable.</div>}</AsyncState></>;
}
