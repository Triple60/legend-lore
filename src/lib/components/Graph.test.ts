import { render } from '@testing-library/svelte';
import type { Core } from 'cytoscape';
import { describe, expect, it, vi } from 'vitest';
import { makeNode, makeType } from '../../tests/fixtures';
import Graph from './Graph.svelte';

// jsdom has no canvas. Cytoscape's renderer only needs calls not to throw, so
// hand it a context where every property is a no-op function.
const noop: object = new Proxy(() => noop, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop) });
HTMLCanvasElement.prototype.getContext = (() => noop) as never;

function setup() {
	const onselect = vi.fn();
	const onbackground = vi.fn();
	const place = makeType({ id: 'place' });
	const { container } = render(Graph, {
		campaignId: 'c1',
		nodes: [makeNode({ id: 'n1', type_id: 'place' })],
		edges: [],
		types: { place },
		selectedId: null,
		highlight: null,
		onselect,
		onbackground
	});
	// Cytoscape registers its instance on the container element.
	const el = container.querySelector('.graph') as HTMLElement & { _cyreg: { cy: Core } };
	return { cy: el._cyreg.cy, onselect, onbackground };
}

describe('Graph', () => {
	it('reports a tap on empty canvas as a background click, not a selection', () => {
		const { cy, onselect, onbackground } = setup();
		cy.emit('tap');
		expect(onbackground).toHaveBeenCalledOnce();
		expect(onselect).not.toHaveBeenCalled();
	});

	it('reports a tap on a node as a selection only', () => {
		const { cy, onselect, onbackground } = setup();
		cy.getElementById('n1').emit('tap');
		expect(onselect).toHaveBeenCalledWith('n1');
		expect(onbackground).not.toHaveBeenCalled();
	});
});
