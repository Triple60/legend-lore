import { defineEnvVars } from '@sveltejs/kit/env';

// Both values come from Supabase (Project Settings → API) and are public by
// design: access control is enforced by row-level security in the database.
// They are inlined at build time, since GitHub Pages has no runtime env.
const optional = (value: string | undefined) => value || undefined;

export const variables = defineEnvVars({
	PUBLIC_SUPABASE_URL: {
		public: true,
		static: true,
		schema: optional,
		description: 'Supabase project URL, e.g. https://abcd.supabase.co'
	},
	PUBLIC_SUPABASE_ANON_KEY: {
		public: true,
		static: true,
		schema: optional,
		description: 'Supabase publishable key (sb_publishable_…) or legacy anon key'
	},
	PUBLIC_EMAIL_LOGIN: {
		public: true,
		static: true,
		schema: (value: string | undefined) => value === 'true',
		description: 'Set to "true" to offer email one-time-code login (needs SMTP set up in Supabase)'
	}
});
