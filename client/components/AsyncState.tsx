import type { ReactNode } from 'react';
import s from '../styles/ui.module.css';

export function AsyncState({ loading, error, empty, children, retry }: { loading: boolean; error?: Error | null; empty?: boolean; children: ReactNode; retry?: () => void }) {
  if (loading) return <div className={s.empty} role="status">Loading…</div>;
  if (error) return <div className={s.empty} role="alert"><div><p>That section could not be loaded.</p><p className={s.muted}>{error.message}</p>{retry && <button className={s.secondaryButton} onClick={retry}>Try again</button>}</div></div>;
  if (empty) return <div className={s.empty}><p>Nothing here yet. Use Create to add the first item.</p></div>;
  return children;
}
