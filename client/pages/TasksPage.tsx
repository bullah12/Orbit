import { Filter, Plus } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AsyncState } from '../components/AsyncState';
import { PageHeader } from '../components/AppShell';
import { TaskRow } from '../components/TaskRow';
import { useSpaces, useTasks } from '../data/hooks';
import type { TaskFilter } from '../data/api';
import s from '../styles/ui.module.css';
import { useSpaceScope } from '../components/SpaceScope';

const filters: TaskFilter[] = ['mine', 'today', 'upcoming', 'inbox', 'waiting', 'someday', 'done', 'all'];

export default function TasksPage() {
  const [params] = useSearchParams();
  const { list: routeFilter = 'today' } = useParams();
  const filter = filters.includes(routeFilter as TaskFilter) ? routeFilter as TaskFilter : 'today';
  const { space } = useSpaceScope(); const assignee = params.get('assignee') ?? '';
  const spaces = useSpaces(); const tasks = useTasks(filter, space, assignee);
  return <>
    <PageHeader title="Tasks" subtitle="Keep the work visible without making it noisy." actions={<button className={s.primaryButton} onClick={() => window.dispatchEvent(new Event('orbit:create'))}><Plus size={18} />New task</button>} />
    <div className={s.toolbar} style={{ marginBottom: '1rem' }}><div className={s.segments} aria-label="Smart lists">{filters.map((item) => <Link className={`${s.segButton} ${filter === item ? s.segActive : ''}`} aria-current={filter === item ? 'page' : undefined} to={`/tasks/${item}${params.toString() ? `?${params}` : ''}`} key={item}>{item[0]?.toUpperCase()}{item.slice(1)}</Link>)}</div><span className={s.chip}><Filter size={15} />{tasks.data?.length ?? 0}</span></div>
    <section className={s.workspace}>
      <div className={s.workspaceList}><AsyncState loading={tasks.isLoading} error={tasks.error} empty={tasks.data?.length === 0} retry={() => void tasks.refetch()}><ul className={s.list}>{tasks.data?.map((task) => <TaskRow task={task} spaces={spaces.data} key={task.id} />)}</ul></AsyncState></div>
      <div className={s.workspaceDetail}><div className={s.empty}><div><h2>Select a task</h2><p>Choose a task from the list to edit its details, checklist, assignment and dates.</p></div></div></div>
    </section>
  </>;
}
