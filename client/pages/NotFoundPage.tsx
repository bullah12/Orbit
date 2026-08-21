import { Link } from 'react-router-dom';
import { PageHeader } from '../components/AppShell';
import s from '../styles/ui.module.css';
export default function NotFoundPage() { return <><PageHeader title="Page not found" /><div className={s.card}><p>That Orbit page does not exist.</p><Link className={s.primaryButton} to="/">Return to Today</Link></div></>; }
