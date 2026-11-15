import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

// GitHub Pages serves project sites from /<repo-name>. The deploy workflow sets
// BASE_PATH=/legend-lore; locally it is empty so the dev server runs at /.
const base = (process.env.BASE_PATH ?? '') as '' | `/${string}`;

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Fully static output. Every page is prerendered as an empty shell and
			// rendered in the browser (see src/routes/+layout.ts), so GitHub Pages
			// can serve it without any server. Dynamic data is passed via query
			// strings (e.g. /campaign?id=...) rather than route params.
			adapter: adapter({ fallback: '404.html' }),
			paths: { base }
		}),
		// Only active under Vitest: browser builds of Svelte + DOM cleanup.
		svelteTesting()
	],
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: 'app',
					environment: 'jsdom',
					include: ['src/**/*.test.ts'],
					setupFiles: ['src/tests/setup.ts']
				}
			},
			{
				// Runs the real migration in an in-memory Postgres (PGlite).
				extends: true,
				test: {
					name: 'db',
					environment: 'node',
					include: ['supabase/tests/**/*.test.ts'],
					testTimeout: 30_000,
					hookTimeout: 60_000
				}
			}
		]
	}
});
