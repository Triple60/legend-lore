import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_DEMO, PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$app/env/public';
import { createDemoClient } from './demo/client.ts';

/** A demo build: sample data held in memory, reset on every page load. */
export const isDemo = PUBLIC_DEMO;

export const isConfigured = isDemo || Boolean(PUBLIC_SUPABASE_URL && PUBLIC_SUPABASE_ANON_KEY);

// When the env vars are missing (e.g. a fresh clone), the app renders a setup
// notice instead of crashing; see src/routes/+layout.svelte.
export const supabase: SupabaseClient = isDemo
	? (createDemoClient() as unknown as SupabaseClient)
	: createClient(PUBLIC_SUPABASE_URL ?? 'http://localhost:54321', PUBLIC_SUPABASE_ANON_KEY ?? 'missing-anon-key', {
			auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true }
		});
