import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import s from '../styles/ui.module.css';

type Mode = 'sign-in' | 'sign-up' | 'magic';

export default function SignInPage() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const intended = (location.state as { from?: string } | null)?.from ?? '/';
  if (auth.session) return <Navigate to={intended} replace />;
  return <main className={s.authPage}>
    <section className={s.authBrand} aria-label="Orbit introduction"><div className={s.brand}><span className={s.brandMark}>O</span><span>Orbit</span></div><h1>Your household, calmly in hand.</h1><p className={s.muted}>Plan the day, share the load, and keep the details close without turning home into a dashboard.</p></section>
    <section className={s.authFormWrap}>
      <form className={`${s.form} ${s.authForm}`} onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setError(''); setMessage('');
        const form = new FormData(event.currentTarget); const email = String(form.get('email') ?? ''); const password = String(form.get('password') ?? '');
        try {
          if (!auth.configured) throw new Error('Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env.local before signing in.');
          if (mode === 'magic') {
            const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(intended)}` } });
            if (error) throw error; setMessage('Check your email for a secure sign-in link.');
          } else if (mode === 'sign-up') {
            const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(intended)}` } });
            if (error) throw error; setMessage('Account created. Check your email if confirmation is enabled.');
          } else {
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error; navigate(intended, { replace: true });
          }
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in failed.'); }
        finally { setPending(false); }
      }}>
        <div><div className={s.brand}><span className={s.brandMark}>O</span><span>Orbit</span></div><h1>{mode === 'sign-in' ? 'Welcome back' : mode === 'sign-up' ? 'Create your account' : 'Email me a sign-in link'}</h1><p className={s.muted}>Use your Supabase account to continue.</p></div>
        <div className={s.segments}>{(['sign-in', 'sign-up', 'magic'] as const).map((item) => <button type="button" className={`${s.segButton} ${mode === item ? s.segActive : ''}`} onClick={() => setMode(item)} key={item}>{item === 'sign-in' ? 'Sign in' : item === 'sign-up' ? 'Sign up' : 'Magic link'}</button>)}</div>
        <div className={s.field}><label htmlFor="email">Email</label><input className={s.input} id="email" name="email" type="email" autoComplete="email" required /></div>
        {mode !== 'magic' && <div className={s.field}><label htmlFor="password">Password</label><input className={s.input} id="password" name="password" type="password" minLength={8} autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} required /></div>}
        {error && <div className={s.error} role="alert">{error}</div>}{message && <p className={s.success} role="status">{message}</p>}
        <button className={s.primaryButton} disabled={pending}>{pending ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : mode === 'sign-up' ? 'Create account' : 'Send magic link'}</button>
      </form>
    </section>
  </main>;
}
