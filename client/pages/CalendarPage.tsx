import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AsyncState } from '../components/AsyncState';
import { PageHeader } from '../components/AppShell';
import { listEvents } from '../data/api';
import { queryKeys } from '../data/queryKeys';
import { addDays, formatShortDate, formatTime, isoDate, startOfDay, startOfWeek } from '../lib/date';
import { expandEvents } from '../lib/recurrence';
import { useAuth } from '../auth/AuthProvider';
import { useSpaces } from '../data/hooks';
import s from '../styles/ui.module.css';

const EventEditor = lazy(() => import('../components/CalendarEventEditor'));
type View = 'day' | 'week' | 'month';

export default function CalendarPage() {
  const auth = useAuth(); const spaces = useSpaces();
  const [params, setParams] = useSearchParams(); const view = (['day', 'week', 'month'].includes(params.get('view') ?? '') ? params.get('view') : 'week') as View;
  const selected = params.get('date') ? new Date(`${params.get('date')}T12:00:00`) : new Date();
  const from = view === 'day' ? startOfDay(selected) : view === 'week' ? startOfWeek(selected) : startOfWeek(new Date(selected.getFullYear(), selected.getMonth(), 1));
  const to = view === 'day' ? addDays(from, 1) : view === 'week' ? addDays(from, 7) : addDays(from, 42);
  const freeBusySpaceIds = (spaces.data ?? []).filter((space) => space.space_members?.some((member) => member.user_id === auth.user?.id && member.role === 'free_busy')).map((space) => space.id);
  const events = useQuery({ queryKey: [...queryKeys.calendar(from.toISOString(), to.toISOString()), ...freeBusySpaceIds], queryFn: () => listEvents(from, to, freeBusySpaceIds), placeholderData: (previous) => previous });
  const occurrences = useMemo(() => expandEvents(events.data ?? [], from, to), [events.data, from.getTime(), to.getTime()]);
  const days = Array.from({ length: view === 'day' ? 1 : view === 'week' ? 7 : 42 }, (_, index) => addDays(from, index));
  const move = (amount: number) => { const next = new Date(selected); if (view === 'month') next.setMonth(next.getMonth() + amount); else next.setDate(next.getDate() + amount * (view === 'week' ? 7 : 1)); const copy = new URLSearchParams(params); copy.set('date', isoDate(next)); setParams(copy); };
  return <>
    <PageHeader title="Calendar" subtitle={`${formatShortDate(from)} – ${formatShortDate(addDays(to, -1))}`} actions={<div className={s.toolbar}><button className={s.iconButton} onClick={() => move(-1)} aria-label={`Previous ${view}`}><ChevronLeft size={19} /></button><button className={s.secondaryButton} onClick={() => { const next = new URLSearchParams(params); next.set('date', isoDate(new Date())); setParams(next); }}>Today</button><button className={s.iconButton} onClick={() => move(1)} aria-label={`Next ${view}`}><ChevronRight size={19} /></button><button className={s.primaryButton} onClick={() => { const next = new URLSearchParams(params); next.set('new', '1'); setParams(next); }}><Plus size={18} />Event</button></div>} />
    <div className={s.toolbar} style={{ marginBottom: '1rem' }}><div className={s.segments} aria-label="Calendar view">{(['day', 'week', 'month'] as const).map((item) => <button className={`${s.segButton} ${view === item ? s.segActive : ''}`} aria-pressed={view === item} onClick={() => { const next = new URLSearchParams(params); next.set('view', item); setParams(next); }} key={item}>{item.charAt(0).toUpperCase() + item.slice(1)}</button>)}</div></div>
    <AsyncState loading={events.isLoading} error={events.error} retry={() => void events.refetch()}>
      {view === 'month' ? <section className={s.month} aria-label="Month calendar">{days.map((day) => { const key = isoDate(day); const rows = occurrences.filter((event) => isoDate(new Date(event.occurrenceStart)) === key); return <article className={s.monthCell} key={key}><strong>{new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' }).format(day)}</strong>{rows.map((event) => <button className={s.monthEvent} key={`${event.id}-${event.occurrenceStart}`} onClick={() => { const next = new URLSearchParams(params); next.set('event', event.id); setParams(next); }}>{event.is_locked ? 'Locked' : event.title || 'Busy'}</button>)}</article>; })}</section> : <section className={s.calendar} aria-label={`${view} calendar`}>{days.map((day) => { const key = isoDate(day); const rows = occurrences.filter((event) => isoDate(new Date(event.occurrenceStart)) === key); return <article className={s.calendarDay} key={key}><header className={s.dayHeader}><strong>{new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(day)}</strong><br />{day.getDate()}</header>{rows.map((event) => <button className={s.event} key={`${event.id}-${event.occurrenceStart}`} onClick={() => { const next = new URLSearchParams(params); next.set('event', event.id); setParams(next); }}><strong>{event.is_locked ? 'Locked event' : event.title || 'Busy'}</strong><span className={s.rowMeta}>{event.all_day ? 'All day' : `${formatTime(event.occurrenceStart)}–${formatTime(event.occurrenceEnd)}`}</span></button>)}</article>; })}</section>}
    </AsyncState>
    {(params.has('event') || params.has('new')) && <Suspense fallback={null}><EventEditor id={params.get('event')} date={params.get('date') ?? isoDate(new Date())} onClose={() => { const next = new URLSearchParams(params); next.delete('event'); next.delete('new'); setParams(next); }} /></Suspense>}
  </>;
}
