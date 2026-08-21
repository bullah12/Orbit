import { CalendarDays, FileText, ListTodo, MapPin, Search, UserRound } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/AppShell';
import { globalSearch } from '../data/api';
import { queryKeys } from '../data/queryKeys';
import { useSpaces } from '../data/hooks';
import s from '../styles/ui.module.css';

const icons = { task: ListTodo, note: FileText, person: UserRound, event: CalendarDays, place: MapPin };
export default function SearchPage() {
  const [query, setQuery] = useState(''); const results = useQuery({ queryKey: queryKeys.search(query), queryFn: () => globalSearch(query), enabled: query.trim().length >= 2 }); const spaces = useSpaces();
  return <><PageHeader title="Search" subtitle="Search readable, unlocked records across your spaces." /><div className={s.quickAdd}><Search size={19} /><input autoFocus className={s.input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Orbit" /></div><section className={`${s.card} ${s.cardFlush}`}>{query.trim().length < 2 ? <div className={s.empty}>Type two or more characters.</div> : results.isFetching ? <div className={s.empty}>Searching…</div> : <ul className={s.list}>{results.data?.map((row) => { const Icon = icons[row.type]; const space = spaces.data?.find((item) => item.id === row.space_id); return <li key={`${row.type}-${row.id}`}><Link className={s.row} to={row.path}><Icon size={18} /><span className={s.rowMain}><span className={s.rowTitle}>{row.title}</span><span className={s.rowMeta}>{row.type} · {row.subtitle}</span></span>{space && <span className={s.spaceChip}><span className={s.spaceDot} />{space.short_label}</span>}</Link></li>; })}</ul>}{query.length >= 2 && !results.isFetching && !results.data?.length && <div className={s.empty}>No matches.</div>}</section></>;
}
