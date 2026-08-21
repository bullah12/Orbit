import { List, Map as MapIcon, MapPin, Search, UserRound, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AsyncState } from '../components/AsyncState';
import { PageHeader } from '../components/AppShell';
import { getPeopleDirectory } from '../data/api';
import { queryKeys } from '../data/queryKeys';
import { useSpaces } from '../data/hooks';
import s from '../styles/ui.module.css';

const PeopleMap = lazy(() => import('../components/PeopleMap'));

export default function PeoplePage() {
  const [search, setSearch] = useState('');
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'map' ? 'map' : 'list';
  const activeTags = params.getAll('tag');
  const people = useQuery({ queryKey: queryKeys.people, queryFn: getPeopleDirectory });
  const spaces = useSpaces();
  const availableTags = useMemo(() => {
    const tags = new Map<string, { id: string; name: string; slug: string; count: number }>();
    for (const person of people.data ?? []) for (const tag of person.tags) {
      const current = tags.get(tag.slug);
      tags.set(tag.slug, { ...tag, count: (current?.count ?? 0) + 1 });
    }
    return [...tags.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [people.data]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (people.data ?? []).filter((person) => {
      const matchesSearch = !needle || [person.display_name, person.nickname, person.home_place?.name, person.home_place?.city, ...person.tags.map((tag) => tag.name)].some((value) => value?.toLocaleLowerCase().includes(needle));
      const matchesTags = activeTags.length === 0 || activeTags.every((slug) => person.tags.some((tag) => tag.slug === slug));
      return matchesSearch && matchesTags;
    });
  }, [activeTags.join('|'), people.data, search]);
  const mappedCount = filtered.filter((person) => person.home_place?.geom).length;
  const setView = (nextView: 'list' | 'map') => { const next = new URLSearchParams(params); next.set('view', nextView); setParams(next); };
  const toggleTag = (slug: string) => {
    const next = new URLSearchParams(params);
    const tags = next.getAll('tag');
    next.delete('tag');
    for (const tag of tags.includes(slug) ? tags.filter((item) => item !== slug) : [...tags, slug]) next.append('tag', tag);
    setParams(next);
  };

  return <>
    <PageHeader title="People" subtitle={view === 'map' ? `${mappedCount} of ${filtered.length} filtered people have a place` : `${filtered.length} ${filtered.length === 1 ? 'person' : 'people'}`} actions={<div className={s.segments} aria-label="People view"><button className={`${s.segButton} ${view === 'list' ? s.segActive : ''}`} aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={17} />List</button><button className={`${s.segButton} ${view === 'map' ? s.segActive : ''}`} aria-pressed={view === 'map'} onClick={() => setView('map')}><MapIcon size={17} />Map</button></div>} />
    <div className={s.peopleControls}>
      <label className={s.searchField} htmlFor="people-search"><Search size={18} aria-hidden /><span className="sr-only">Search people</span><input id="people-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people, places or tags" type="search" />{search && <button type="button" onClick={() => setSearch('')} aria-label="Clear people search"><X size={17} /></button>}</label>
      {availableTags.length > 0 && <div className={s.filterChips} aria-label="Filter people by tag">{availableTags.map((tag) => { const active = activeTags.includes(tag.slug); return <button key={tag.id} className={`${s.filterChip} ${active ? s.filterChipActive : ''}`} aria-pressed={active} onClick={() => toggleTag(tag.slug)}><span>{tag.name}</span><small>{tag.count}</small></button>; })}{activeTags.length > 0 && <button className={s.clearFilters} onClick={() => { const next = new URLSearchParams(params); next.delete('tag'); setParams(next); }}>Clear</button>}</div>}
    </div>
    <AsyncState loading={people.isLoading} error={people.error} retry={() => void people.refetch()}>
      {view === 'map' ? <Suspense fallback={<div className={s.mapNotice} role="status">Loading people map…</div>}><PeopleMap people={filtered} /></Suspense> : <section className={`${s.card} ${s.cardFlush}`}><ul className={s.list}>{filtered.map((person) => <li key={person.id}><Link className={s.personRow} to={`/people/${person.id}`}><span className={s.personAvatar}>{person.display_name.slice(0, 1).toLocaleUpperCase() || <UserRound size={18} />}</span><span className={s.rowMain}><span className={s.rowTitle}>{person.is_locked ? 'Locked person' : person.display_name}</span><span className={s.rowMeta}>{person.nickname && <span>“{person.nickname}”</span>}<span>{spaces.data?.find((space) => space.id === person.space_id)?.name}</span>{person.home_place && <span className={s.placeMeta}><MapPin size={13} />{person.home_place.name}</span>}</span>{person.tags.length > 0 && <span className={s.personTags}>{person.tags.map((tag) => <span className={s.personTag} key={tag.id}>{tag.name}</span>)}</span>}</span></Link></li>)}</ul>{filtered.length === 0 && <div className={s.empty}>No people match those filters.</div>}</section>}
    </AsyncState>
  </>;
}
