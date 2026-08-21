import { CalendarDays, CircleAlert, ListTodo, UserRoundCheck } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { AsyncState } from '../components/AsyncState';
import { PageHeader } from '../components/AppShell';
import { TaskRow } from '../components/TaskRow';
import { createTask } from '../data/api';
import { useProfile, useSpaces, useToday } from '../data/hooks';
import { formatLongDate, formatTime, isoDate } from '../lib/date';
import { expandEvents } from '../lib/recurrence';
import s from '../styles/ui.module.css';

export default function TodayPage() {
  const [range, setRange] = useState(1);
  const [quick, setQuick] = useState('');
  const [adding, setAdding] = useState(false);
  const auth = useAuth(); const profile = useProfile(); const spaces = useSpaces(); const today = useToday(range); const client = useQueryClient();
  const tasks = today.data?.tasks ?? []; const events = expandEvents(today.data?.events ?? [], new Date(`${isoDate(new Date())}T00:00:00`), new Date(Date.now() + range * 86_400_000));
  const date = isoDate(new Date());
  const due = tasks.filter((task) => task.due_on === date);
  const overdue = tasks.filter((task) => task.due_on && task.due_on < date);
  const mine = tasks.filter((task) => task.assignee_id === auth.user?.id);
  const upcomingDates = (today.data?.dates ?? []).map((item) => {
    const [, month, day] = item.on_date.split('-').map(Number); const occurrence = new Date(new Date().getFullYear(), (month ?? 1) - 1, day ?? 1);
    if (occurrence < new Date(`${date}T00:00:00`)) occurrence.setFullYear(occurrence.getFullYear() + 1);
    return { item, occurrence };
  }).filter(({ occurrence }) => occurrence < new Date(Date.now() + 31 * 86_400_000)).sort((a, b) => a.occurrence.getTime() - b.occurrence.getTime());
  const defaultSpace = profile.data?.default_space_id ?? spaces.data?.find((space) => space.is_default)?.id ?? spaces.data?.[0]?.id;
  return <>
    <PageHeader title="Today" subtitle={formatLongDate(new Date())} actions={<div className={s.segments} aria-label="Today range">{[{ n: 1, l: 'Today' }, { n: 7, l: '7 days' }, { n: 30, l: '30 days' }].map((item) => <button key={item.n} className={`${s.segButton} ${range === item.n ? s.segActive : ''}`} aria-pressed={range === item.n} onClick={() => setRange(item.n)}>{item.l}</button>)}</div>} />
    <form className={s.quickAdd} onSubmit={async (event) => {
      event.preventDefault(); if (!quick.trim() || !defaultSpace || !auth.user) return; setAdding(true);
      try { await createTask({ title: quick.trim(), space_id: defaultSpace, owner_id: auth.user.id, due_on: date }); setQuick(''); await client.invalidateQueries({ queryKey: ['today'] }); }
      finally { setAdding(false); }
    }}><label className="sr-only" htmlFor="quick-add">Quick add task</label><input id="quick-add" className={s.input} value={quick} onChange={(event) => setQuick(event.target.value)} placeholder="Add a task for today…" /><button className={s.primaryButton} disabled={adding || !quick.trim()}>{adding ? 'Adding…' : 'Add task'}</button></form>
    <AsyncState loading={today.isLoading} error={today.error} retry={() => void today.refetch()}>
      <section className={`${s.grid} ${s.summaryGrid}`} aria-label="Today summary">
        <div className={s.summary}><CalendarDays size={19} aria-hidden /><strong>{events.length}</strong><span>events</span></div>
        <div className={s.summary}><ListTodo size={19} aria-hidden /><strong>{due.length}</strong><span>due</span></div>
        <div className={s.summary}><CircleAlert size={19} aria-hidden /><strong>{overdue.length}</strong><span>overdue</span></div>
        <div className={s.summary}><UserRoundCheck size={19} aria-hidden /><strong>{mine.length}</strong><span>assigned to me</span></div>
      </section>
      <div className={`${s.grid} ${s.todayGrid}`}>
        <section className={`${s.card} ${s.cardFlush}`} aria-labelledby="agenda-title"><div className={s.cardHeader}><h2 id="agenda-title">Agenda</h2><span className={s.muted}>{range === 1 ? 'Today' : `Next ${range} days`}</span></div>
          {events.length === 0 ? <div className={s.empty}>Your agenda is clear. Create an event when plans take shape.</div> : <ol className={s.list}>{events.map((event) => <li className={s.row} key={`${event.id}-${event.occurrenceStart}`}><time className={s.chip}>{event.all_day ? 'All day' : formatTime(event.occurrenceStart)}</time><div className={s.rowMain}><span className={s.rowTitle}>{event.is_locked ? 'Locked event' : event.title || 'Busy'}</span><span className={s.rowMeta}>{event.location_text && <span>{event.location_text}</span>}</span></div></li>)}</ol>}
        </section>
        <section className={`${s.card} ${s.cardFlush}`} aria-labelledby="tasks-title"><div className={s.cardHeader}><h2 id="tasks-title">Due & overdue</h2><Link to="/tasks/today">View tasks</Link></div>
          {tasks.length === 0 ? <div className={s.empty}>Nothing is due in this range.</div> : <ul className={s.list}>{tasks.map((task) => <TaskRow task={task} spaces={spaces.data} compact key={task.id} />)}</ul>}
        </section>
      </div>
      <section className={s.card} style={{ marginTop: '1rem' }}><h2>Important dates</h2>{upcomingDates.length ? <ul className={s.list}>{upcomingDates.slice(0, 8).map(({ item, occurrence }) => <li className={s.row} key={item.id}><div className={s.rowMain}><span className={s.rowTitle}>{item.people?.display_name ?? 'Someone'} · {item.label || item.kind}</span><span className={s.rowMeta}>{formatLongDate(occurrence)}</span></div></li>)}</ul> : <p className={s.muted}>No important dates in the next 30 days.</p>}</section>
    </AsyncState>
  </>;
}
