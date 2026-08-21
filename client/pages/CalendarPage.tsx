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
  const auth = useAuth();
  const spaces = useSpaces();
  const [params, setParams] = useSearchParams();
  const view = (['day', 'week', 'month'].includes(params.get('view') ?? '') ? params.get('view') : 'week') as View;
  const selected = params.get('date') ? new Date(`${params.get('date')}T12:00:00`) : new Date();
  const from = view === 'day' ? startOfDay(selected) : view === 'week' ? startOfWeek(selected) : startOfWeek(new Date(selected.getFullYear(), selected.getMonth(), 1));
  const to = view === 'day' ? addDays(from, 1) : view === 'week' ? addDays(from, 7) : addDays(from, 42);
  const freeBusySpaceIds = (spaces.data ?? []).filter((space) => space.space_members?.some((member) => member.user_id === auth.user?.id && member.role === 'free_busy')).map((space) => space.id);
  const events = useQuery({ queryKey: [...queryKeys.calendar(from.toISOString(), to.toISOString()), ...freeBusySpaceIds], queryFn: () => listEvents(from, to, freeBusySpaceIds), placeholderData: (previous) => previous });
  const occurrences = useMemo(() => expandEvents(events.data ?? [], from, to), [events.data, from.getTime(), to.getTime()]);
  const days = Array.from({ length: view === 'day' ? 1 : view === 'week' ? 7 : 42 }, (_, index) => addDays(from, index));
  const selectedKey = isoDate(selected);
  const selectedOccurrences = occurrences.filter((event) => isoDate(new Date(event.occurrenceStart)) === selectedKey);
  const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(selected);
  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(updates)) value === null ? next.delete(key) : next.set(key, value);
    setParams(next);
  };
  const move = (amount: number) => {
    const next = new Date(selected);
    if (view === 'month') next.setMonth(next.getMonth() + amount);
    else next.setDate(next.getDate() + amount * (view === 'week' ? 7 : 1));
    updateParams({ date: isoDate(next) });
  };
  const openEvent = (id: string) => updateParams({ event: id });

  return <>
    <PageHeader title="Calendar" subtitle={view === 'month' ? monthName : `${formatShortDate(from)} – ${formatShortDate(addDays(to, -1))}`} actions={<div className={`${s.toolbar} ${s.calendarActions}`}><button className={s.iconButton} onClick={() => move(-1)} aria-label={`Previous ${view}`}><ChevronLeft size={19} /></button><button className={s.secondaryButton} onClick={() => updateParams({ date: isoDate(new Date()) })}>Today</button><button className={s.iconButton} onClick={() => move(1)} aria-label={`Next ${view}`}><ChevronRight size={19} /></button><button className={s.primaryButton} onClick={() => updateParams({ new: '1' })}><Plus size={18} />Event</button></div>} />
    <div className={s.calendarViewBar}><div className={s.segments} aria-label="Calendar view">{(['day', 'week', 'month'] as const).map((item) => <button className={`${s.segButton} ${view === item ? s.segActive : ''}`} aria-pressed={view === item} onClick={() => updateParams({ view: item })} key={item}>{item.charAt(0).toUpperCase() + item.slice(1)}</button>)}</div></div>
    <AsyncState loading={events.isLoading} error={events.error} retry={() => void events.refetch()}>
      <div className={s.desktopCalendar}>
        {view === 'month' ? <section className={s.month} aria-label="Month calendar">{days.map((day) => { const key = isoDate(day); const rows = occurrences.filter((event) => isoDate(new Date(event.occurrenceStart)) === key); return <article className={s.monthCell} key={key}><strong>{new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' }).format(day)}</strong>{rows.map((event) => <button className={s.monthEvent} key={`${event.id}-${event.occurrenceStart}`} onClick={() => openEvent(event.id)}>{event.is_locked ? 'Locked' : event.title || 'Busy'}</button>)}</article>; })}</section> : <section className={s.calendar} aria-label={`${view} calendar`}>{days.map((day) => { const key = isoDate(day); const rows = occurrences.filter((event) => isoDate(new Date(event.occurrenceStart)) === key); return <article className={s.calendarDay} key={key}><header className={s.dayHeader}><strong>{new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(day)}</strong><br />{day.getDate()}</header>{rows.map((event) => <button className={s.event} key={`${event.id}-${event.occurrenceStart}`} onClick={() => openEvent(event.id)}><strong>{event.is_locked ? 'Locked event' : event.title || 'Busy'}</strong><span className={s.rowMeta}>{event.all_day ? 'All day' : `${formatTime(event.occurrenceStart)}–${formatTime(event.occurrenceEnd)}`}</span></button>)}</article>; })}</section>}
      </div>
      <div className={s.mobileCalendar}>
        {view === 'month' ? <><div className={s.monthWeekdays} aria-hidden>{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div><div className={s.mobileMonth} aria-label={`${monthName} calendar`}>{days.map((day) => { const key = isoDate(day); const count = occurrences.filter((event) => isoDate(new Date(event.occurrenceStart)) === key).length; const outside = day.getMonth() !== selected.getMonth(); return <button key={key} className={`${s.mobileMonthDay} ${key === selectedKey ? s.mobileDaySelected : ''} ${outside ? s.mobileDayOutside : ''}`} aria-pressed={key === selectedKey} onClick={() => updateParams({ date: key })}><span>{day.getDate()}</span>{count > 0 && <i aria-label={`${count} event${count === 1 ? '' : 's'}`} />}</button>; })}</div></> : view === 'week' ? <div className={s.mobileWeek} aria-label="Choose a day">{days.map((day) => { const key = isoDate(day); const count = occurrences.filter((event) => isoDate(new Date(event.occurrenceStart)) === key).length; return <button key={key} className={`${s.mobileWeekDay} ${key === selectedKey ? s.mobileDaySelected : ''}`} aria-pressed={key === selectedKey} onClick={() => updateParams({ date: key })}><span>{new Intl.DateTimeFormat('en-GB', { weekday: 'narrow' }).format(day)}</span><strong>{day.getDate()}</strong>{count > 0 && <i aria-hidden />}</button>; })}</div> : null}
        <section className={s.mobileAgenda} aria-label={`Events for ${formatShortDate(selected)}`}><h2>{new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(selected)}</h2>{selectedOccurrences.length ? selectedOccurrences.map((event) => <button className={s.mobileEvent} key={`${event.id}-${event.occurrenceStart}`} onClick={() => openEvent(event.id)}><span className={s.eventTime}>{event.all_day ? 'All day' : formatTime(event.occurrenceStart)}</span><span className={s.rowMain}><strong className={s.rowTitle}>{event.is_locked ? 'Locked event' : event.title || 'Busy'}</strong><span className={s.rowMeta}>{event.all_day ? '' : `Until ${formatTime(event.occurrenceEnd)}`}</span></span></button>) : <div className={s.emptyDay}>Nothing planned. Tap Event to add something.</div>}</section>
      </div>
    </AsyncState>
    {(params.has('event') || params.has('new')) && <Suspense fallback={null}><EventEditor id={params.get('event')} date={params.get('date') ?? isoDate(new Date())} onClose={() => updateParams({ event: null, new: null })} /></Suspense>}
  </>;
}
