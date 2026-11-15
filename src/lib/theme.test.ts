import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('theme', () => {
	beforeEach(() => {
		localStorage.clear();
		delete document.documentElement.dataset.theme;
		vi.resetModules();
	});

	it('follows the system until the person picks one', async () => {
		vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('light'), addEventListener() {} }));
		const { theme } = await import('./theme.svelte.ts');
		expect(theme.current).toBe('light');
		expect(document.documentElement.dataset.theme).toBeUndefined();
		vi.unstubAllGlobals();
	});

	it('toggles, sets data-theme and remembers the choice', async () => {
		const { theme, STORAGE_KEY } = await import('./theme.svelte.ts');
		const start = theme.current;
		theme.toggle();
		const next = start === 'dark' ? 'light' : 'dark';
		expect(theme.current).toBe(next);
		expect(document.documentElement.dataset.theme).toBe(next);
		expect(localStorage.getItem(STORAGE_KEY)).toBe(next);
	});

	it('restores a saved choice', async () => {
		localStorage.setItem('legend-lore:theme', 'light');
		const { theme } = await import('./theme.svelte.ts');
		expect(theme.current).toBe('light');
	});
});
