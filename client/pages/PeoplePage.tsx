import { Search, UserRound } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AsyncState } from '../components/AsyncState';
import { PageHeader } from '../components/AppShell';
import { listPeople } from '../data/api';
import { queryKeys } from '../data/queryKeys';
import { useSpaces } from '../data/hooks';
import s from '../styles/ui.module.css';

export default function PeoplePage() {
  const [search, setSearch] = useState(''); const people = useQuery({ queryKey: queryKeys.people(search), queryFn: () => listPeople(search), placeholderData: (previous) => previous }); const spaces = useSpaces();
  return <><PageHeader title="People" subtitle="The people who matter, with the useful details close by." /><div className={s.quickAdd}><label className="sr-only" htmlFor="people-search">Search people</label><input id="people-search" className={s.input} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people" /><button className={s.secondaryButton}><Search size={18} />Search</button></div><section className={`${s.card} ${s.cardFlush}`}><AsyncState loading={people.isLoading} error={people.error} empty={people.data?.length === 0} retry={() => void people.refetch()}><ul className={s.list}>{people.data?.map((person) => <li key={person.id}><Link className={s.row} to={`/people/${person.id}`}><span className={s.brandMark}><UserRound size={18} /></span><span className={s.rowMain}><span className={s.rowTitle}>{person.is_locked ? 'Locked person' : person.display_name}</span><span className={s.rowMeta}>{person.nickname && <span>“{person.nickname}”</span>}<span>{spaces.data?.find((space) => space.id === person.space_id)?.name}</span>{person.home_place_id ? <span>Home recorded</span> : <span>No home place</span>}</span></span></Link></li>)}</ul></AsyncState></section></>;
}
