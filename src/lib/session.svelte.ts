import type { Session } from '@supabase/supabase-js';
import { debug, short } from './debug.svelte';
import { isConfigured, supabase } from './supabase';

// Global auth state. `ready` flips once the stored session (or an OAuth/PKCE
// redirect in the URL) has been processed, so pages don't flash "signed out".
class SessionState {
	session = $state<Session | null>(null);
	ready = $state(false);

	get user() {
		return this.session?.user ?? null;
	}

	start() {
		if (!isConfigured) {
			this.ready = true;
			return;
		}
		supabase.auth.getSession().then(({ data }) => {
			this.session = data.session;
			this.ready = true;
		});
		supabase.auth.onAuthStateChange((event, session) => {
			debug.log('auth', `${event} user=${short(session?.user?.id)}`);
			this.session = session;
			this.ready = true;
		});
	}
}

export const auth = new SessionState();
