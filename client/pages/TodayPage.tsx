import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { AsyncState } from '../components/AsyncState';
import { PageHeader } from '../components/AppShell';
import { TaskRow } from '../components/TaskRow';
import { useComposeSpace, useSpaceScope } from '../components/SpaceScope';
import { createTask } from '../data/api';
import { useSpaces, useToday } from '../data/hooks';
import type { Task } from '../data/types';
import { addDays, formatLongDate, formatShortDate, formatTime, isoDate, startOfDay } from '../lib/date';
import { expandEvents } from '../lib/recurrence';
import s from '../styles/ui.module.css';

export default function TodayPage() {
  const [range, setRange] = useState(7);
  const [quick, setQuick] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const auth = useAuth(); const spaces = useSpaces(); const today = useToday(range); const client = useQueryClient();
  const { space } = useSpaceScope(); const { defaultSpace } = useComposeSpace();
  const start = startOfDay(new Date()); const end = addDays(start, range); const date = isoDate(start);
  const tasks = (today.data?.tasks ?? []).filter((task) => (!space || task.space_id === space) && ['todo', 'doing', 'blocked'].includes(task.status) && (!task.deferred_until || new Date(task.deferred_until) <= new Date()));
  const priority = { urgent: 0, high: 1, normal: 2, low: 3, none: 4 };
  const sorted = [...tasks].sort((a, b) => priority[a.priority] - priority[b.priority] || (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999'));
  const needsAttention = (task: Task) => task.priority === 'urgent' || Boolean(task.due_on && task.due_on < date);
  const attention = sorted.filter(needsAttention);
  const due = sorted.filter((task) => !needsAttention(task) && task.due_on === date);
  const upcoming = sorted.filter((task) => !needsAttention(task) && task.due_on && task.due_on > date && task.due_on < isoDate(end));
  const inbox = sorted.filter((task) => !task.due_on && !task.deferred_until && task.status === 'todo');
  const events = expandEvents((today.data?.events ?? []).filter((event) => !space || event.space_id === space), start, end);
  const upcomingDates = (today.data?.dates ?? []).filter((item) => !space || item.space_id === space).map((item) => {
    const [, month, day] = item.on_date.split('-').map(Number);
    const occurrence = new Date(start.getFullYear(), (month ?? 1) - 1, day ?? 1);
    if (occurrence < start) occurrence.setFullYear(occurrence.getFullYear() + 1);
    return { item, occurrence };
  }).filter(({ occurrence }) => occurrence < addDays(start, 31)).sort((a, b) => a.occurrence.getTime() - b.occurrence.getTime());
  const taskSection = (title: string, rows: Task[], empty: string) => <section className={`${s.card} ${s.cardFlush}`} aria-label={title}><div className={s.cardHeader}><h2>{title}</h2><span className={s.chip}>{rows.length}</span></div>{rows.length ? <ul className={s.list}>{rows.map((task) => <TaskRow task={task} spaces={spaces.data} key={task.id} />)}</ul> : <p className={s.empty}>{empty}</p>}</section>;

  return <>
    <PageHeader title="Today" subtitle={formatLongDate(start)} actions={<Link className={s.secondaryButton} to="/tasks/inbox">Inbox</Link>} />
    <form className={`${s.card} ${s.capture}`} onSubmit={async (event) => {
      event.preventDefault(); if (adding || !quick.trim() || !defaultSpace || !auth.user) return;
      setAdding(true); setError(''); setMessage('');
      const destination = spaces.data?.find((item) => item.id === defaultSpace)?.name ?? 'your space';
      try {
        await createTask({ title: quick.trim(), space_id: defaultSpace, owner_id: auth.user.id, due_on: dueOn || null, priority: urgent ? 'urgent' : 'normal' });
        setQuick(''); setDueOn(''); setUrgent(false); setMessage(`Saved to ${destination}${dueOn ? '' : ' · Inbox'}.`);
        await Promise.all([client.invalidateQueries({ queryKey: ['today'] }), client.invalidateQueries({ queryKey: ['tasks'] })]);
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save. Your task is still here—try again.'); }
      finally { setAdding(false); }
    }}>
      <label htmlFor="quick-add" className={s.label}>What do you need to do?</label>
      <div className={s.quickAdd}><input id="quick-add" className={s.input} value={quick} onChange={(event) => setQuick(event.target.value)} placeholder="Add a task…" maxLength={200} disabled={adding} /><button className={s.primaryButton} disabled={adding || !quick.trim() || !defaultSpace}>{adding ? 'Saving…' : 'Add task'}</button></div>
      <div className={s.toolbar}><label className={s.captureDate}>Due <input aria-label="Task due date" className={s.input} type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} disabled={adding} /></label><label><input type="checkbox" checked={urgent} onChange={(event) => setUrgent(event.target.checked)} disabled={adding} /> Urgent</label><span className={s.muted}>{defaultSpace ? `In ${spaces.data?.find((item) => item.id === defaultSpace)?.name} · No date goes to Inbox` : 'Choose or create a writable space to add tasks.'}</span></div>
      {error && <p className={s.error} role="alert">{error}</p>}{message && <p className={s.success} role="status">{message}</p>}
    </form>
    <AsyncState loading={today.isLoading} error={today.error} retry={() => void today.refetch()}>
      <div className={s.homeSections}>
        {taskSection('Needs attention', attention, 'No overdue or urgent tasks.')}
        {taskSection('Due today', due, 'Nothing else is due today.')}
        <section className={`${s.card} ${s.cardFlush}`} aria-label="Agenda"><div className={s.cardHeader}><h2>Agenda</h2><Link to="/calendar">Calendar</Link></div>{events.length ? <ol className={s.list}>{events.map((event) => <li className={s.row} key={`${event.id}-${event.occurrenceStart}`}><span className={s.chip}>{formatShortDate(event.occurrenceStart)} · {event.all_day ? 'All day' : formatTime(event.occurrenceStart)}</span><div className={s.rowMain}><span className={s.rowTitle}>{event.is_locked ? 'Locked event' : event.title || 'Busy'}</span><span className={s.rowMeta}>{event.location_text}</span></div></li>)}</ol> : <p className={s.empty}>No events in this range.</p>}</section>
        <div className={s.sectionHeading}><h2>Coming up</h2><div className={s.segments} aria-label="Upcoming range">{[7, 30].map((days) => <button key={days} className={`${s.segButton} ${range === days ? s.segActive : ''}`} aria-pressed={range === days} onClick={() => setRange(days)}>{days} days</button>)}</div></div>
        {taskSection('Upcoming tasks', upcoming, 'No upcoming deadlines in this range.')}
        <section className={s.card}><h2>Inbox</h2><p className={s.muted}>{inbox.length} unscheduled {inbox.length === 1 ? 'task' : 'tasks'} to organise when you are ready.</p><Link to="/tasks/inbox">Open inbox</Link></section>
        <section className={s.card}><h2>Important dates</h2>{upcomingDates.length ? <ul className={s.list}>{upcomingDates.slice(0, 8).map(({ item, occurrence }) => <li className={s.row} key={item.id}><div className={s.rowMain}><span className={s.rowTitle}>{item.people?.display_name ?? 'Someone'} · {item.label || item.kind}</span><span className={s.rowMeta}>{formatLongDate(occurrence)}</span></div></li>)}</ul> : <p className={s.muted}>No important dates in the next 30 days.</p>}</section>
      </div>
    </AsyncState>
  </>;
}
