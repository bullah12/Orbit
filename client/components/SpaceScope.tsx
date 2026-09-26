import { createContext, use, useEffect, useState, type PropsWithChildren } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useProfile, useSpaces } from '../data/hooks';
import s from '../styles/ui.module.css';

const ScopeContext = createContext<{ space: string; setSpace: (id: string) => void } | null>(null);

export function SpaceScopeProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const key = `orbit-space:${user?.id ?? ''}`;
  const [params, setParams] = useSearchParams();
  const [space, update] = useState(() => {
    try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
  });
  const setSpace = (id: string) => {
    update(id);
    try { localStorage.setItem(key, id); } catch { /* Selection still works without storage. */ }
    if (params.has('space')) { const next = new URLSearchParams(params); next.delete('space'); setParams(next, { replace: true }); }
  };
  const linkedSpace = params.get('space');
  useEffect(() => {
    if (linkedSpace !== null) {
      update(linkedSpace);
      try { localStorage.setItem(key, linkedSpace); } catch { /* Keep URL selection in memory. */ }
    }
  }, [linkedSpace, key]);
  return <ScopeContext value={{ space: linkedSpace ?? space, setSpace }}>{children}</ScopeContext>;
}

export function useSpaceScope() {
  const scope = use(ScopeContext);
  if (!scope) throw new Error('SpaceScopeProvider is required');
  const spaces = useSpaces();
  return { ...scope, space: spaces.data?.some((item) => item.id === scope.space) ? scope.space : '' };
}

export function useComposeSpace() {
  const { space } = useSpaceScope();
  const { user } = useAuth();
  const spaces = useSpaces();
  const profile = useProfile();
  const writable = (spaces.data ?? []).filter((item) => item.owner_id === user?.id || item.space_members?.some((member) => member.user_id === user?.id && ['owner', 'admin', 'member'].includes(member.role)));
  return { writable, defaultSpace: writable.find((item) => item.id === space)?.id ?? writable.find((item) => item.id === profile.data?.default_space_id)?.id ?? writable.find((item) => item.is_default)?.id ?? writable[0]?.id ?? '' };
}

export function SpaceScopePicker() {
  const { space, setSpace } = useSpaceScope();
  const spaces = useSpaces();
  return <div className={s.scopeBar}><label htmlFor="orbit-space">View</label><select id="orbit-space" className={s.select} value={space} onChange={(event) => setSpace(event.target.value)}><option value="">All spaces</option>{spaces.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>;
}
