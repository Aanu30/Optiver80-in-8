import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// When the env vars aren't set (e.g. before Supabase is configured) the app
// runs in local-only "guest" mode and no sign-in UI appears.
export const supabase = url && key ? createClient(url, key) : null;
