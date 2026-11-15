export interface Point {
	x: number;
	y: number;
}

export interface Size {
	width: number;
	height: number;
}

/**
 * Where to put a box of `size` so its top-left is at `at`, nudged so the whole
 * box stays `margin` inside `bounds`. If the box is bigger than the bounds it
 * sticks to the top/left.
 */
export function clampInto(at: Point, size: Size, bounds: Size, margin = 8): Point {
	const fit = (v: number, len: number, max: number) => Math.max(margin, Math.min(v, max - len - margin));
	return { x: fit(at.x, size.width, bounds.width), y: fit(at.y, size.height, bounds.height) };
}

/** Whether the person has asked for less motion. */
export function prefersReducedMotion(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
