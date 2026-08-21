import { CalendarDays, ChevronDown, CircleUserRound, FileText, Home, ListTodo, MapPin, Menu, MoreHorizontal, Plus, Search, Settings, UserRound } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useProfile, useSpaces } from '../data/hooks';
import { CommandPalette } from './CommandPalette';
import { CreateDialog } from './CreateDialog';
import s from '../styles/ui.module.css';

const primary = [
  { to: '/', label: 'Today', icon: Home, end: true },
  { to: '/tasks/today', label: 'Tasks', icon: ListTodo },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/people', label: 'People', icon: UserRound },
  { to: '/notes', label: 'Notes', icon: FileText },
  { to: '/places', label: 'Places', icon: MapPin },
];

const mobile = [primary[0]!, primary[1]!, primary[2]!, { to: '/more', label: 'More', icon: MoreHorizontal }];

function NavItem({ item }: { item: { to: string; label: string; icon: typeof Home; end?: boolean } }) {
  const Icon = item.icon;
  return <NavLink to={item.to} end={item.end} className={({ isActive }: { isActive: boolean }) => `${s.navLink} ${isActive ? s.navActive : ''}`}><Icon size={20} aria-hidden /><span>{item.label}</span></NavLink>;
}

export function AppShell() {
  const [palette, setPalette] = useState(false);
  const [create, setCreate] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const profile = useProfile();
  const spaces = useSpaces();
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches('input,textarea,select,[contenteditable="true"]');
      if ((event.key === '/' && !typing) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) { event.preventDefault(); setPalette(true); }
      if (event.key === 'n' && !typing) { event.preventDefault(); setCreate(true); }
      if (event.key === 'Escape') { setPalette(false); setCreate(false); }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  useEffect(() => {
    const openCreate = () => setCreate(true);
    window.addEventListener('orbit:create', openCreate);
    return () => window.removeEventListener('orbit:create', openCreate);
  }, []);
  useEffect(() => { document.getElementById('route-heading')?.focus({ preventScroll: true }); }, [location.pathname]);
  return <div className={s.shell}>
    <aside className={s.sidebar} aria-label="Primary navigation">
      <NavLink className={s.brand} to="/"><span className={s.brandMark}>O</span><span>Orbit</span></NavLink>
      <button className={s.createButton} onClick={() => setCreate(true)}><Plus size={19} /><span>Create</span></button>
      <nav className={s.nav}>{primary.map((item) => <NavItem key={item.to} item={item} />)}</nav>
      <nav className={`${s.nav} ${s.spaceNav}`} aria-label="Spaces">
        {spaces.data?.map((space) => <NavLink key={space.id} className={s.navLink} to={`/spaces/${space.id}`}><span className={s.spaceDot} aria-hidden /><span>{space.name}</span></NavLink>)}
      </nav>
      <nav className={`${s.nav} ${s.sidebarBottom}`}>
        <NavItem item={{ to: '/settings', label: 'Settings', icon: Settings }} />
      </nav>
    </aside>
    <div className={s.main}>
      <header className={s.topbar}>
        <button className={s.searchButton} onClick={() => setPalette(true)}><Search size={18} /><span>Search Orbit</span><span className={s.key}>⌘ K</span></button>
        <button className={s.userButton} onClick={() => navigate('/settings')}><CircleUserRound size={19} /><span>{profile.data?.display_name ?? auth.user?.email ?? 'Account'}</span><ChevronDown size={15} /></button>
      </header>
      <main className={s.content}><Outlet /></main>
    </div>
    <nav className={s.bottomNav} aria-label="Mobile navigation">{mobile.map((item) => <NavItem key={item.to} item={item} />)}</nav>
    <button className={s.fab} onClick={() => setCreate(true)} aria-label="Create item"><Plus size={24} /></button>
    <CommandPalette open={palette} onClose={() => setPalette(false)} />
    <CreateDialog open={create} onClose={() => setCreate(false)} />
  </div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string | undefined; actions?: ReactNode }) {
  return <header className={s.pageHeader}><div><h1 id="route-heading" tabIndex={-1}>{title}</h1>{subtitle && <p className={s.muted}>{subtitle}</p>}</div>{actions}</header>;
}
