import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(url && publishableKey);

export const supabase = createClient(
  url ?? 'http://127.0.0.1:54321',
  publishableKey ?? 'orbit-local-missing-key',
  {
    db: { schema: 'orbit' },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
    realtime: { params: { eventsPerSecond: 0 } },
  },
);
