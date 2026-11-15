import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTypingTarget, loadShortcutsEnabled, saveShortcutsEnabled, shortcutFor } from './shortcuts';

const key = (k: string, init: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { key: k, ...init });
const el = (html: string) => {
	const wrap = document.createElement('div');
	wrap.innerHTML = html;
	return wrap.firstElementChild!;
};

describe('shortcutFor', () => {
	it.each([
		['/', 'search'],
		['n', 'new-node'],
		['N', 'new-node'],
		['Escape', 'back']
	])('maps %s to %s when nothing is focused', (k, action) => {
		expect(shortcutFor(key(k), document.body)).toBe(action);
		expect(shortcutFor(key(k), null)).toBe(action);
	});

	it('ignores other keys, including Space', () => {
		for (const k of [' ', 'm', 'Enter', 'Tab', '?']) expect(shortcutFor(key(k), document.body)).toBeNull();
	});

	it('allows Shift, which some layouts need for "/"', () => {
		expect(shortcutFor(key('/', { shiftKey: true }), document.body)).toBe('search');
	});

	it.each(['ctrlKey', 'metaKey', 'altKey'])('leaves %s combinations to the browser', (mod) => {
		expect(shortcutFor(key('n', { [mod]: true }), document.body)).toBeNull();
	});

	it('ignores held-down repeats and IME composition', () => {
		expect(shortcutFor(key('n', { repeat: true }), document.body)).toBeNull();
		expect(shortcutFor(key('n', { isComposing: true }), document.body)).toBeNull();
	});

	it('ignores keys another handler already used', () => {
		const e = key('n', { cancelable: true });
		e.preventDefault();
		expect(shortcutFor(e, document.body)).toBeNull();
	});

	it.each([
		'<input>',
		'<input type="number">',
		'<input type="search">',
		'<textarea></textarea>',
		'<select><option>Npc</option></select>',
		'<div contenteditable="true"></div>',
		'<div role="combobox"></div>'
	])('does not fire while typing in %s', (html) => {
		const target = el(html);
		document.body.append(target);
		try {
			for (const k of ['/', 'n', 'Escape']) expect(shortcutFor(key(k), target)).toBeNull();
		} finally {
			target.remove();
		}
	});

	it('still fires when a button or link has focus', () => {
		expect(shortcutFor(key('n'), el('<button>Re-layout</button>'))).toBe('new-node');
		expect(shortcutFor(key('/'), el('<a href="#">x</a>'))).toBe('search');
	});
});

describe('isTypingTarget', () => {
	it('is false for nothing, the page, and plain elements', () => {
		expect(isTypingTarget(null)).toBe(false);
		expect(isTypingTarget(document.body)).toBe(false);
		expect(isTypingTarget(el('<canvas></canvas>'))).toBe(false);
	});
});

describe('the on/off setting', () => {
	afterEach(() => {
		localStorage.clear();
		vi.restoreAllMocks();
	});

	it('is on by default', () => {
		expect(loadShortcutsEnabled()).toBe(true);
	});

	it('remembers being turned off and back on', () => {
		saveShortcutsEnabled(false);
		expect(loadShortcutsEnabled()).toBe(false);
		saveShortcutsEnabled(true);
		expect(loadShortcutsEnabled()).toBe(true);
	});

	it('falls back to on when storage is unavailable', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(() => saveShortcutsEnabled(false)).not.toThrow();
		expect(loadShortcutsEnabled()).toBe(true);
	});
});
