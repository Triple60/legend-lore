import { describe, expect, it } from 'vitest';
import { countCrossings, layoutLoss, optimizeLayout, optimizeLayoutInBackground, segmentsCross, type LayoutEdge, type LayoutNode } from './graph-layout.ts';

const node = (id: string, x: number, y: number, width = 40): LayoutNode => ({ id, x, y, width });
const edge = (source: string, target: string, length = 110): LayoutEdge => ({ source, target, length });
const placed = (nodes: LayoutNode[], pos: Map<string, { x: number; y: number }>) =>
	nodes.map((n) => ({ ...n, ...pos.get(n.id)! }));

describe('segmentsCross', () => {
	it('spots an X, but not parallel or touching lines', () => {
		expect(segmentsCross(0, 0, 10, 10, 0, 10, 10, 0)).toBe(true);
		expect(segmentsCross(0, 0, 10, 0, 0, 5, 10, 5)).toBe(false);
		expect(segmentsCross(0, 0, 10, 10, 10, 10, 20, 0)).toBe(false);
	});
});

describe('countCrossings', () => {
	it('counts crossing connections, ignoring ones that share a node', () => {
		const nodes = [node('a', 0, 0), node('b', 100, 100), node('c', 100, 0), node('d', 0, 100)];
		expect(countCrossings(nodes, [edge('a', 'b'), edge('c', 'd')])).toBe(1);
		expect(countCrossings(nodes, [edge('a', 'b'), edge('a', 'c')])).toBe(0);
	});
});

describe('optimizeLayout', () => {
	// A ring of six drawn as a tangle: every other node swapped across.
	const ring = ['a', 'b', 'c', 'd', 'e', 'f'];
	const tangled = ring.map((id, i) => {
		const angle = ((i * 2) % 6) * (Math.PI / 3) + (i >= 3 ? 0.5 : 0);
		return node(id, Math.cos(angle) * 150, Math.sin(angle) * 150);
	});
	const ringEdges = ring.map((id, i) => edge(id, ring[(i + 1) % 6]));

	it('untangles crossing connections', () => {
		expect(countCrossings(tangled, ringEdges)).toBeGreaterThan(0);
		const out = placed(tangled, optimizeLayout(tangled, ringEdges, { seed: 7 }));
		expect(countCrossings(out, ringEdges)).toBe(0);
	});

	it('lowers the loss and never makes it worse', () => {
		const out = placed(tangled, optimizeLayout(tangled, ringEdges, { seed: 3 }));
		expect(layoutLoss(out, ringEdges)).toBeLessThan(layoutLoss(tangled, ringEdges));
	});

	it('pulls connected nodes close but keeps every node apart', () => {
		const spread = [node('a', -600, 0), node('b', 600, 0), node('c', 0, 500), node('d', 0, -500)];
		const out = placed(spread, optimizeLayout(spread, [edge('a', 'b'), edge('c', 'd')], { seed: 1 }));
		const d = (p: LayoutNode, q: LayoutNode) => Math.hypot(p.x - q.x, p.y - q.y);
		expect(d(out[0], out[1])).toBeLessThan(250);
		expect(d(out[2], out[3])).toBeLessThan(250);
		for (let i = 0; i < out.length; i++)
			for (let j = i + 1; j < out.length; j++) expect(d(out[i], out[j])).toBeGreaterThan(40);
	});

	it('keeps the map centred where it was', () => {
		const out = placed(tangled, optimizeLayout(tangled, ringEdges, { seed: 2 }));
		const mid = (ns: LayoutNode[]) => ns.reduce((s, n) => s + n.x, 0) / ns.length;
		expect(mid(out)).toBeCloseTo(mid(tangled), 6);
	});

	it('is repeatable for the same seed (with no time limit)', () => {
		const a = optimizeLayout(tangled, ringEdges, { seed: 5, timeBudget: Infinity });
		const b = optimizeLayout(tangled, ringEdges, { seed: 5, timeBudget: Infinity });
		expect([...a]).toEqual([...b]);
	});

	it('copes with tiny maps and stray connections', () => {
		expect([...optimizeLayout([], [])]).toEqual([]);
		expect(optimizeLayout([node('a', 3, 4)], [edge('a', 'missing')]).get('a')).toEqual({ x: 3, y: 4 });
	});
});

describe('optimizeLayoutInBackground', () => {
	it('gives the same answer as optimizeLayout when there are no workers (as here)', async () => {
		const nodes = [node('a', 0, 0), node('b', 300, 0), node('c', 0, 300)];
		const edges = [edge('a', 'b'), edge('b', 'c')];
		const options = { seed: 4, timeBudget: Infinity };
		expect([...(await optimizeLayoutInBackground(nodes, edges, options))]).toEqual([
			...optimizeLayout(nodes, edges, options)
		]);
	});
});
