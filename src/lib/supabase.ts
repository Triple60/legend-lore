import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$app/env/public';

export const isConfigured = Boolean(PUBLIC_SUPABASE_URL && PUBLIC_SUPABASE_ANON_KEY);

// When the env vars are missing (e.g. a fresh clone), the app renders a setup
// notice instead of crashing; see src/routes/+layout.svelte.
export const supabase: SupabaseClient = createClient(
	PUBLIC_SUPABASE_URL ?? 'http://localhost:54321',
	PUBLIC_SUPABASE_ANON_KEY ?? 'missing-anon-key',
	{ auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } }
);
