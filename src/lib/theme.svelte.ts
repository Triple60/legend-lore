/**
 * Light / dark theme. By default the app follows the operating system; once
 * the person flips the switch, their choice is remembered per browser.
 *
 * The choice is written to `<html data-theme="…">`, which tokens.css reads.
 * app.html applies the saved choice before first paint, so there's no flash.
 */

export type Theme = 'light' | 'dark';

export const STORAGE_KEY = 'legend-lore:theme';

/**
 * How long a switch between light and dark fades for. Must match
 * `--theme-fade` in tokens.css. Reduced motion switches instantly.
 */
export const THEME_FADE_MS = 2000;
/** Class on <html> while the colours fade (see tokens.css). */
export const FADING_CLASS = 'theme-fading';

function reducedMotion(): boolean {
	try {
		return matchMedia('(prefers-reduced-motion: reduce)').matches;
	} catch {
		return false;
	}
}

function systemTheme(): Theme {
	try {
		return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
	} catch {
		return 'dark';
	}
}

function savedTheme(): Theme | null {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		return v === 'light' || v === 'dark' ? v : null;
	} catch {
		return null;
	}
}

class ThemeState {
	/** A theme the person picked, or null to follow the system. */
	#chosen = $state<Theme | null>(savedTheme());
	#system = $state<Theme>(systemTheme());
	/** True while a switch is fading in; the map follows the fade while it is. */
	fading = $state(false);
	#fadeTimer: ReturnType<typeof setTimeout> | undefined;

	constructor() {
		try {
			matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
				this.#system = e.matches ? 'light' : 'dark';
			});
		} catch {
			/* no matchMedia (tests): stay on the initial value */
		}
	}

	/** The theme in effect right now. */
	get current(): Theme {
		return this.#chosen ?? this.#system;
	}

	set(theme: Theme) {
		if (theme !== this.current) this.#fade();
		this.#chosen = theme;
		document.documentElement.dataset.theme = theme;
		try {
			localStorage.setItem(STORAGE_KEY, theme);
		} catch {
			/* storage unavailable: the choice lasts until the tab closes */
		}
	}

	/** Let the colour tokens transition for a moment, then switch them off again. */
	#fade() {
		if (reducedMotion()) return;
		const root = document.documentElement;
		clearTimeout(this.#fadeTimer);
		root.classList.add(FADING_CLASS);
		this.fading = true;
		this.#fadeTimer = setTimeout(() => {
			root.classList.remove(FADING_CLASS);
			this.fading = false;
		}, THEME_FADE_MS + 100);
	}

	toggle() {
		this.set(this.current === 'dark' ? 'light' : 'dark');
	}
}

export const theme = new ThemeState();
