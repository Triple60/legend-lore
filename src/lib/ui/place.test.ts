import { describe, expect, it } from 'vitest';
import { clampInto } from './place';

const bounds = { width: 400, height: 300 };
const box = { width: 100, height: 50 };

describe('clampInto', () => {
	it('leaves a box that fits where it was asked', () => {
		expect(clampInto({ x: 50, y: 60 }, box, bounds)).toEqual({ x: 50, y: 60 });
	});

	it('pulls a box back inside the right and bottom edges', () => {
		expect(clampInto({ x: 390, y: 290 }, box, bounds)).toEqual({ x: 292, y: 242 });
	});

	it('pushes a box off the left and top edges', () => {
		expect(clampInto({ x: -20, y: -5 }, box, bounds)).toEqual({ x: 8, y: 8 });
	});

	it('sticks a box bigger than the bounds to the top-left', () => {
		expect(clampInto({ x: 10, y: 10 }, { width: 500, height: 400 }, bounds)).toEqual({ x: 8, y: 8 });
	});
});
