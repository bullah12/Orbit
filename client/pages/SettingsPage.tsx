import { LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { PageHeader } from '../components/AppShell';
import { useProfile, useSpaces, useUpdateProfile } from '../data/hooks';
import type { Profile } from '../data/types';
import s from '../styles/ui.module.css';

function applyTheme(theme: Profile['theme']) {
  localStorage.setItem('orbit-theme', theme);
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.themePreference = theme;
}

export default function SettingsPage() {
  const auth = useAuth(); const profile = useProfile(); const spaces = useSpaces(); const update = useUpdateProfile(); const [message, setMessage] = useState('');
  useEffect(() => { if (profile.data?.theme) applyTheme(profile.data.theme); }, [profile.data?.theme]);
  return <><PageHeader title="Settings" subtitle="Account and planning preferences." /><div className={`${s.grid} ${s.todayGrid}`}><form className={`${s.card} ${s.form}`} onSubmit={async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); setMessage('Saving…'); try { const theme = String(data.get('theme')) as Profile['theme']; applyTheme(theme); await update.mutateAsync({ display_name: String(data.get('display_name')), theme, week_starts_on: Number(data.get('week_starts_on')), default_space_id: String(data.get('default_space_id')) || null }); setMessage('Saved'); } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Save failed'); } }}><h2>Preferences</h2><div className={s.field}><label htmlFor="display-name">Display name</label><input id="display-name" className={s.input} name="display_name" defaultValue={profile.data?.display_name} /></div><div className={s.field}><label htmlFor="theme">Theme</label><select id="theme" className={s.select} name="theme" defaultValue={profile.data?.theme ?? 'system'}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div><div className={s.field}><label htmlFor="week-start">Week starts on</label><select id="week-start" className={s.select} name="week_starts_on" defaultValue={profile.data?.week_starts_on ?? 1}><option value="1">Monday</option><option value="0">Sunday</option><option value="6">Saturday</option></select></div><div className={s.field}><label htmlFor="default-space">Default compose space</label><select id="default-space" className={s.select} name="default_space_id" defaultValue={profile.data?.default_space_id ?? ''}><option value="">Automatic</option>{spaces.data?.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></div>{message && <p role="status" className={message === 'Saved' ? s.success : s.muted}>{message}</p>}<button className={s.primaryButton} disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Save preferences'}</button></form><section className={s.card}><h2>Account</h2><p><strong>{auth.user?.email}</strong></p><p className={s.muted}>Sessions refresh automatically through Supabase Auth. Signing out removes this browser session.</p><button className={s.secondaryButton} onClick={() => void auth.signOut()}><LogOut size={18} />Sign out</button></section></div></>;
}
