import type { Session, User } from '@supabase/supabase-js';
import { createContext, use, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  configured: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const client = useQueryClient();
  const identity = useRef<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) void supabase.auth.signOut({ scope: 'local' });
      setSession(error ? null : data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (identity.current !== (next?.user.id ?? null)) client.clear();
      identity.current = next?.user.id ?? null;
      setSession(next);
      setLoading(false);
      if (next) void supabase.rpc('ensure_account');
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  const value = useMemo<AuthState>(() => ({
    session,
    user: session?.user ?? null,
    loading,
    configured: isSupabaseConfigured,
    signOut: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      client.clear();
    },
  }), [session, loading, client]);

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const context = use(AuthContext);
  if (!context) throw new Error('useAuth must be inside AuthProvider');
  return context;
}

export function ProtectedRoute({ children }: PropsWithChildren) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading) return <div className="route-status" role="status">Restoring your session…</div>;
  if (!auth.session) {
    return <Navigate to="/sign-in" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return children;
}
