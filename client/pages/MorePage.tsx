import { FileText, MapPin, Search, Settings, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/AppShell';
import s from '../styles/ui.module.css';

export default function MorePage() {
  return <><PageHeader title="More" subtitle="People, notes, places and account settings." /><section className={`${s.card} ${s.cardFlush}`}><nav className={s.list}>{[{ to: '/people', label: 'People', icon: UserRound }, { to: '/notes', label: 'Notes', icon: FileText }, { to: '/places', label: 'Places', icon: MapPin }, { to: '/search', label: 'Search', icon: Search }, { to: '/settings', label: 'Settings', icon: Settings }].map(({ to, label, icon: Icon }) => <Link className={s.row} to={to} key={to}><Icon size={20} /><span className={s.rowTitle}>{label}</span></Link>)}</nav></section></>;
}
