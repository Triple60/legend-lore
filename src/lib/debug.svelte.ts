/**
 * An opt-in event log for tracking down problems on the live site, where
 * there's no debugger attached. Turn it on by opening any page with `?debug`
 * in the address (and off again with `?debug=off`); the choice is
 * remembered per browser. While it's on, a small panel in the corner shows
 * the latest events and can copy the whole log to paste into a bug report.
 *
 * It records the things that can open or close an editor or reload data:
 * login events, the live connection, who is editing what, incoming changes,
 * panels opening and closing, and the tab being hidden or shown. It never
 * records what you type, only how much.
 */

import { untrack } from 'svelte';

const STORAGE_KEY = 'legend-lore:debug';
/** Oldest entries are dropped past this many. */
const MAX_ENTRIES = 1000;

export interface DebugEntry {
	/** Seconds since the page loaded. */
	t: number;
	event: string;
	detail: string;
}

function readEnabled(): boolean {
	try {
		const flag = new URLSearchParams(location.search).get('debug');
		if (flag !== null) localStorage.setItem(STORAGE_KEY, flag === 'off' || flag === '0' ? 'off' : 'on');
		return localStorage.getItem(STORAGE_KEY) === 'on';
	} catch {
		return false;
	}
}

class DebugLog {
	enabled = $state(false);
	entries = $state.raw<DebugEntry[]>([]);
	#started = false;
	#t0 = typeof performance !== 'undefined' ? performance.now() : 0;

	/** Check the address and storage for the switch, and start watching the tab. */
	start() {
		if (this.#started) return;
		this.#started = true;
		this.enabled = readEnabled();
		if (!this.enabled) return;
		this.log('debug on', `${navigator.userAgent} · ${location.pathname}${location.search}`);
		document.addEventListener('visibilitychange', () => this.log('tab', document.visibilityState));
		window.addEventListener('pageshow', (e) => this.log('page shown', e.persisted ? 'from back/forward cache' : ''));
		addEventListener('pagehide', () => this.log('page hidden (unloading or cached)'));
		addEventListener('online', () => this.log('network', 'online'));
		addEventListener('offline', () => this.log('network', 'offline'));
		addEventListener('error', (e) => this.log('error', String(e.message)));
		addEventListener('unhandledrejection', (e) => this.log('unhandled rejection', String(e.reason)));
	}

	log(event: string, detail: unknown = '') {
		if (!untrack(() => this.enabled)) return;
		const entry = {
			t: Math.round(performance.now() - this.#t0) / 1000,
			event,
			detail: typeof detail === 'string' ? detail : JSON.stringify(detail)
		};
		console.debug('[legend-lore]', entry.t, event, entry.detail);
		// Logging from inside an effect mustn't make that effect depend on the
		// log, or each entry would re-run it.
		untrack(() => {
			const next = this.entries.length >= MAX_ENTRIES ? this.entries.slice(1) : this.entries.slice();
			next.push(entry);
			this.entries = next;
		});
	}

	/** The whole log as plain text, one event per line. */
	text() {
		return this.entries.map((e) => `${e.t.toFixed(3).padStart(9)}  ${e.event}${e.detail ? `  ${e.detail}` : ''}`).join('\n');
	}

	clear() {
		this.entries = [];
	}
}

export const debug = new DebugLog();

/** The first few characters of an id, enough to tell ids apart in a log. */
export const short = (id: string | null | undefined) => (id ? id.slice(0, 8) : String(id));
