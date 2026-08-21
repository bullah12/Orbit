import { List, Map, MapPin, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { AsyncState } from '../components/AsyncState';
import { PageHeader } from '../components/AppShell';
import { listPlaces } from '../data/api';
import { queryKeys } from '../data/queryKeys';
import s from '../styles/ui.module.css';

const PlacesMap = lazy(() => import('../components/PlacesMap'));

export default function PlacesPage() {
  const [search, setSearch] = useState(''); const [tab, setTab] = useState<'list' | 'map'>('list'); const places = useQuery({ queryKey: queryKeys.places(search), queryFn: () => listPlaces(search), placeholderData: (previous) => previous });
  return <><PageHeader title="Places" subtitle="Addresses and useful locations. The map loads only when you ask for it." actions={<div className={s.segments}><button className={`${s.segButton} ${tab === 'list' ? s.segActive : ''}`} aria-pressed={tab === 'list'} onClick={() => setTab('list')}><List size={17} />List</button><button className={`${s.segButton} ${tab === 'map' ? s.segActive : ''}`} aria-pressed={tab === 'map'} onClick={() => setTab('map')}><Map size={17} />Map</button></div>} /><div className={s.quickAdd}><label className="sr-only" htmlFor="places-search">Search places</label><input id="places-search" className={s.input} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search places" /><button className={s.secondaryButton}><Search size={18} />Search</button></div><AsyncState loading={places.isLoading} error={places.error} retry={() => void places.refetch()}>{tab === 'map' ? <Suspense fallback={<div className={s.mapNotice} role="status">Loading map…</div>}><PlacesMap places={places.data ?? []} /></Suspense> : <section className={`${s.card} ${s.cardFlush}`}><ul className={s.list}>{places.data?.map((place) => <li key={place.id}><Link className={s.row} to={`/places/${place.id}`}><span className={s.brandMark}><MapPin size={18} /></span><span className={s.rowMain}><span className={s.rowTitle}>{place.is_locked ? 'Locked place' : place.name}</span><span className={s.rowMeta}>{place.address_text && <span>{place.address_text}</span>} {place.city && <span>{place.city}</span>}</span></span></Link></li>)}</ul>{places.data?.length === 0 && <div className={s.empty}>No places yet. Create one to keep an address close by.</div>}</section>}</AsyncState></>;
}
