/**
 * Single-key shortcuts for the campaign page.
 *
 * WCAG 2.1.4 (Character Key Shortcuts) asks that single-key shortcuts can be
 * turned off, since speech input and stray keypresses can trigger them. They
 * are on by default and the setting is remembered per browser.
 */

export type Shortcut = 'search' | 'new-node' | 'back';

export const SHORTCUTS: { keys: string; action: Shortcut; label: string }[] = [
	{ keys: '/', action: 'search', label: 'Search' },
	{ keys: 'N', action: 'new-node', label: 'New node' },
	{ keys: 'Esc', action: 'back', label: 'Close the menu, pop-up or panel, or clear the search' }
];

/** True when keys typed here are meant as text or as input to the control. */
export function isTypingTarget(el: Element | null): boolean {
	if (!el || !(el instanceof HTMLElement)) return false;
	if (el.isContentEditable || el.closest('[contenteditable]:not([contenteditable="false"])')) return true;
	return el.matches('input, textarea, select, [role="textbox"], [role="combobox"], [role="listbox"]');
}

/**
 * The shortcut a keypress triggers, or null. Shortcuts never fire while the
 * person is typing in a field, or when Ctrl, Alt or Cmd is held (so browser
 * shortcuts like Ctrl+N keep working).
 */
export function shortcutFor(e: KeyboardEvent, focused: Element | null): Shortcut | null {
	if (e.defaultPrevented || e.isComposing || e.repeat) return null;
	if (e.ctrlKey || e.metaKey || e.altKey) return null;
	if (isTypingTarget(focused)) return null;
	// Shift is allowed: on some layouts "/" needs it, and Caps Lock gives "N".
	if (e.key === '/') return 'search';
	if (e.key === 'n' || e.key === 'N') return 'new-node';
	if (e.key === 'Escape') return 'back';
	return null;
}

const STORAGE_KEY = 'legend-lore:shortcuts';

export function loadShortcutsEnabled(): boolean {
	try {
		return localStorage.getItem(STORAGE_KEY) !== 'off';
	} catch {
		return true;
	}
}

export function saveShortcutsEnabled(on: boolean) {
	try {
		localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
	} catch {
		/* storage unavailable: the choice lasts for this visit only */
	}
}
