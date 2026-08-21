import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import s from '../styles/ui.module.css';

export default function AuthCallbackPage() {
  const [params] = useSearchParams(); const navigate = useNavigate(); const [error, setError] = useState('');
  useEffect(() => {
    void supabase.auth.getSession().then(({ data, error: authError }) => {
      if (authError || !data.session) { setError(authError?.message ?? 'This sign-in link is invalid or expired.'); return; }
      navigate(params.get('next') || '/', { replace: true });
    });
  }, [navigate, params]);
  return <main className="route-status">{error ? <div><h1>Sign-in link problem</h1><p className={s.error}>{error}</p><a href="/sign-in">Return to sign in</a></div> : <p role="status">Completing sign in…</p>}</main>;
}
