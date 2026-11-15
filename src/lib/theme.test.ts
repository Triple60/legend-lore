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

	it('fades the colours for a moment when switching', async () => {
		vi.useFakeTimers();
		const { theme, FADING_CLASS, THEME_FADE_MS } = await import('./theme.svelte.ts');
		theme.toggle();
		expect(document.documentElement.classList.contains(FADING_CLASS)).toBe(true);
		expect(theme.fading).toBe(true);
		vi.advanceTimersByTime(THEME_FADE_MS + 200);
		expect(document.documentElement.classList.contains(FADING_CLASS)).toBe(false);
		expect(theme.fading).toBe(false);
		vi.useRealTimers();
	});

	it('switches instantly under reduced motion', async () => {
		vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {} }));
		const { theme, FADING_CLASS } = await import('./theme.svelte.ts');
		theme.toggle();
		expect(document.documentElement.classList.contains(FADING_CLASS)).toBe(false);
		vi.unstubAllGlobals();
	});
});
