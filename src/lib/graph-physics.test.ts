import cytoscape, { type Core } from 'cytoscape';
import { describe, expect, it, vi } from 'vitest';
import { GraphPhysics } from './graph-physics.ts';

// Reduced motion makes the simulation settle synchronously, so tests can
// check where things end up without waiting on animation frames.
function setup() {
	const cy = cytoscape({ headless: true, styleEnabled: false });
	cy.add([
		{ group: 'nodes', data: { id: 'a' }, position: { x: 0, y: 0 } },
		{ group: 'nodes', data: { id: 'b' }, position: { x: 1, y: 0 } },
		{ group: 'nodes', data: { id: 'c' }, position: { x: 0, y: 1 } },
		{ group: 'nodes', data: { id: 'lone' }, position: { x: 1, y: 1 } },
		{ group: 'edges', data: { id: 'ab', source: 'a', target: 'b' } },
		{ group: 'edges', data: { id: 'bc', source: 'b', target: 'c' } }
	]);
	const onrest = vi.fn();
	const physics = new GraphPhysics(cy, { reducedMotion: () => true, onrest });
	return { cy, physics, onrest };
}

const pos = (cy: Core, id: string) => ({ ...cy.getElementById(id).position() });
const dist = (cy: Core, a: string, b: string) => {
	const p = pos(cy, a);
	const q = pos(cy, b);
	return Math.hypot(p.x - q.x, p.y - q.y);
};

describe('GraphPhysics', () => {
	it('spreads a fresh map out, keeping connected nodes closer together', () => {
		const { cy, physics, onrest } = setup();
		physics.sync({ fresh: true });
		expect(onrest).toHaveBeenCalled();
		expect(dist(cy, 'a', 'b')).toBeGreaterThan(40);
		expect(dist(cy, 'a', 'b')).toBeLessThan(dist(cy, 'a', 'lone'));
	});

	it('leaves a settled map alone when nothing changed', () => {
		const { cy, physics, onrest } = setup();
		physics.sync({ fresh: true });
		const before = pos(cy, 'a');
		onrest.mockClear();
		physics.sync();
		expect(onrest).not.toHaveBeenCalled();
		expect(pos(cy, 'a')).toEqual(before);
	});

	it('settles again when a node or connection is added', () => {
		const { cy, physics, onrest } = setup();
		physics.sync({ fresh: true });
		onrest.mockClear();
		cy.add({ group: 'edges', data: { id: 'c-lone', source: 'c', target: 'lone' } });
		physics.sync();
		expect(onrest).toHaveBeenCalledOnce();
	});

	it('does not move anything on a plain click (grab and release)', () => {
		const { cy, physics, onrest } = setup();
		physics.sync({ fresh: true });
		const before = cy.nodes().map((n) => ({ ...n.position() }));
		onrest.mockClear();
		cy.getElementById('a').emit('grab').emit('free');
		expect(onrest).not.toHaveBeenCalled();
		expect(cy.nodes().map((n) => ({ ...n.position() }))).toEqual(before);
	});

	it('keeps a dragged node where it was dropped and pulls its neighbour along', () => {
		const { cy, physics } = setup();
		physics.sync({ fresh: true });
		const a = cy.getElementById('a');
		const drop = { x: pos(cy, 'a').x + 600, y: pos(cy, 'a').y };
		const bBefore = pos(cy, 'b');
		a.emit('grab');
		a.position(drop);
		a.emit('drag').emit('free');
		expect(pos(cy, 'a')).toEqual(drop);
		expect(pos(cy, 'b').x).toBeGreaterThan(bBefore.x + 100);
	});

	it('puts a node where asked', () => {
		const { cy, physics } = setup();
		physics.sync({ fresh: true });
		physics.moveTo('lone', { x: 900, y: 900 });
		// It settles from there, so it ends up near that spot, not back where it was.
		expect(dist(cy, 'lone', 'a')).toBeGreaterThan(300);
	});

	it('stops listening once destroyed', () => {
		const { cy, physics, onrest } = setup();
		physics.sync({ fresh: true });
		physics.destroy();
		onrest.mockClear();
		const a = cy.getElementById('a');
		a.emit('grab');
		a.position({ x: 999, y: 999 });
		a.emit('drag').emit('free');
		expect(onrest).not.toHaveBeenCalled();
	});
});
