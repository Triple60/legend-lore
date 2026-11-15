/**
 * Svelte action: a textarea that grows with its text instead of scrolling.
 * `maxRows` caps the growth (it scrolls after that); leave it out for no cap.
 */
export function autogrow(el: HTMLTextAreaElement, maxRows?: number) {
	let cap = maxRows;
	function resize() {
		el.style.height = 'auto';
		const style = getComputedStyle(el);
		const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 20;
		const border = el.offsetHeight - el.clientHeight;
		const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
		const max = cap ? cap * line + padding + border : Infinity;
		const want = el.scrollHeight + border;
		el.style.height = `${Math.min(want, max)}px`;
		el.style.overflowY = want > max ? 'auto' : 'hidden';
	}
	el.addEventListener('input', resize);
	// Wait a frame so a value set by Svelte (and the layout) is in place.
	const frame = requestAnimationFrame(resize);
	resize();
	return {
		update(next?: number) {
			cap = next;
			resize();
		},
		destroy() {
			cancelAnimationFrame(frame);
			el.removeEventListener('input', resize);
		}
	};
}
