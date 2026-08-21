import { ArrowLeft, Plus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useState } from 'react';
import { AsyncState } from '../components/AsyncState';
import { PageHeader } from '../components/AppShell';
import { addChecklistItem, getTask, listMembers, setTaskRecurrence, updateChecklistItem } from '../data/api';
import { useSpaces, useUpdateTask } from '../data/hooks';
import { queryKeys } from '../data/queryKeys';
import s from '../styles/ui.module.css';

export default function TaskDetailPage() {
  const { id = '' } = useParams(); const navigate = useNavigate(); const client = useQueryClient(); const spaces = useSpaces();
  const query = useQuery({ queryKey: queryKeys.task(id), queryFn: () => getTask(id), enabled: Boolean(id) });
  const update = useUpdateTask(); const [item, setItem] = useState(''); const [saved, setSaved] = useState('');
  const checklist = useMutation({ mutationFn: async ({ itemId, done }: { itemId: string; done: boolean }) => updateChecklistItem(itemId, done), onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.task(id) }) });
  const task = query.data?.task;
  const members = useQuery({ queryKey: task ? queryKeys.members(task.space_id) : ['members', ''], queryFn: () => listMembers(task!.space_id), enabled: Boolean(task) });
  return <>
    <PageHeader title={task?.is_locked ? 'Locked task' : task?.title || 'Task'} subtitle={task ? spaces.data?.find((space) => space.id === task.space_id)?.name : undefined} actions={<Link className={s.secondaryButton} to="/tasks/today"><ArrowLeft size={18} />Back to tasks</Link>} />
    <AsyncState loading={query.isLoading} error={query.error} retry={() => void query.refetch()}>
      {task && <form className={`${s.card} ${s.form}`} onSubmit={async (event) => {
        event.preventDefault(); const data = new FormData(event.currentTarget); setSaved('Saving…');
        try { await update.mutateAsync({ id: task.id, changes: { title: String(data.get('title')), body_md: String(data.get('body_md')), status: String(data.get('status')) as typeof task.status, priority: String(data.get('priority')) as typeof task.priority, due_on: String(data.get('due_on')) || null, deferred_until: String(data.get('deferred_until')) ? new Date(String(data.get('deferred_until'))).toISOString() : null, assignee_id: String(data.get('assignee_id')) || null } }); await setTaskRecurrence(task, String(data.get('rrule'))); setSaved('Saved'); }
        catch (cause) { setSaved(cause instanceof Error ? cause.message : 'Save failed'); }
      }}>
        {task.is_locked ? <div className={s.empty}>This record is encrypted by an older Orbit client. Its contents are unavailable in this release.</div> : <>
          <div className={s.field}><label htmlFor="task-title">Title</label><input id="task-title" className={s.input} name="title" defaultValue={task.title} required /></div>
          <div className={s.field}><label htmlFor="task-body">Details</label><textarea id="task-body" className={s.textarea} name="body_md" defaultValue={task.body_md} /></div>
          <div className={s.toolbar}><div className={s.field}><label htmlFor="task-status">Status</label><select id="task-status" className={s.select} name="status" defaultValue={task.status}>{['todo', 'doing', 'blocked', 'done', 'dropped'].map((value) => <option key={value}>{value}</option>)}</select></div><div className={s.field}><label htmlFor="task-priority">Priority</label><select id="task-priority" className={s.select} name="priority" defaultValue={task.priority}>{['none', 'low', 'normal', 'high', 'urgent'].map((value) => <option key={value}>{value}</option>)}</select></div><div className={s.field}><label htmlFor="task-due">Due</label><input id="task-due" className={s.input} type="date" name="due_on" defaultValue={task.due_on ?? ''} /></div><div className={s.field}><label htmlFor="task-defer">Defer until</label><input id="task-defer" className={s.input} type="datetime-local" name="deferred_until" /></div></div>
          <div className={s.field}><label htmlFor="task-assignee">Assignee</label><select id="task-assignee" className={s.select} name="assignee_id" defaultValue={task.assignee_id ?? ''}><option value="">Unassigned</option>{members.data?.filter((member) => member.role !== 'free_busy').map((member) => <option key={member.user_id} value={member.user_id}>{member.profiles?.display_name ?? member.user_id}</option>)}</select></div>
          <div className={s.field}><label htmlFor="task-repeat">Repeat</label><select id="task-repeat" className={s.select} name="rrule" defaultValue={task.recurrence_rules?.rrule ?? ''}><option value="">Does not repeat</option><option value="FREQ=DAILY">Daily</option><option value="FREQ=WEEKLY">Weekly</option><option value="FREQ=MONTHLY">Monthly</option><option value="FREQ=YEARLY">Yearly</option></select></div>
          <section><h2>Checklist</h2><ul className={s.list}>{query.data?.checklist.map((row) => <li className={s.row} key={row.id}><input type="checkbox" checked={row.done} onChange={(event) => checklist.mutate({ itemId: row.id, done: event.target.checked })} aria-label={`${row.done ? 'Reopen' : 'Complete'} ${row.label}`} /><span className={row.done ? s.muted : ''}>{row.label}</span></li>)}</ul><div className={s.quickAdd}><input className={s.input} value={item} onChange={(event) => setItem(event.target.value)} placeholder="Add checklist item" /><button type="button" className={s.secondaryButton} onClick={async () => { if (!item.trim()) return; await addChecklistItem(task, item.trim(), query.data?.checklist.length ?? 0); setItem(''); await client.invalidateQueries({ queryKey: queryKeys.task(id) }); }}><Plus size={17} />Add</button></div></section>
          {saved && <p className={saved === 'Saved' ? s.success : s.muted} role="status">{saved}</p>}<button className={s.primaryButton} disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Save task'}</button>
        </>}
      </form>}
    </AsyncState>
  </>;
}
