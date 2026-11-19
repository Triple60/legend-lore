import { beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { debug, short } from './debug.svelte.ts';

describe('debug log', () => {
	beforeEach(() => {
		debug.clear();
		debug.enabled = false;
	});

	it('records nothing while off', () => {
		debug.log('something');
		expect(debug.entries).toEqual([]);
	});

	it('records events with details while on, and copies as text', () => {
		debug.enabled = true;
		debug.log('editor opened', 'notes');
		debug.log('presence', { who: 'me' });
		expect(debug.entries.map((e) => e.event)).toEqual(['editor opened', 'presence']);
		expect(debug.text()).toMatch(/editor opened {2}notes\n.*presence {2}\{"who":"me"\}/);
	});

	it('logging inside an effect does not make the effect re-run', () => {
		debug.enabled = true;
		let runs = 0;
		const stop = $effect.root(() => {
			$effect(() => {
				runs++;
				debug.log('from an effect');
			});
		});
		flushSync();
		debug.log('another');
		flushSync();
		stop();
		expect(runs).toBe(1);
	});

	it('shortens ids', () => {
		expect(short('aefac424-8494-497d')).toBe('aefac424');
		expect(short(null)).toBe('null');
	});
});
