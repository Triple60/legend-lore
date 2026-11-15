import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Core } from 'cytoscape';
import { describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { makeEdge, makeNode, makeType } from '../../tests/fixtures';
import Graph from './Graph.svelte';

// jsdom has no canvas. Cytoscape's renderer only needs calls not to throw, so
// hand it a context where every property is a no-op function.
const noop: object = new Proxy(() => noop, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop) });
HTMLCanvasElement.prototype.getContext = (() => noop) as never;

function setup({ selectedId = null as string | null } = {}) {
	const onselect = vi.fn();
	const onbackground = vi.fn();
	const onmenu = vi.fn();
	const onconnect = vi.fn();
	const onannotate = vi.fn();
	const place = makeType({ id: 'place' });
	const { container } = render(Graph, {
		campaignId: 'c1',
		nodes: [makeNode({ id: 'n1', type_id: 'place' }), makeNode({ id: 'n2', type_id: 'place' })],
		edges: [
			makeEdge({ id: 'bare', from_id: 'n1', to_id: 'n2' }),
			makeEdge({ id: 'named', from_id: 'n2', to_id: 'n1', annotation: 'rules' })
		],
		types: { place },
		selectedId,
		highlight: null,
		onselect,
		onbackground,
		onmenu,
		onconnect,
		onannotate
	});
	// Cytoscape registers its instance on the container element.
	const el = container.querySelector('.graph') as HTMLElement & { _cyreg: { cy: Core } };
	return { cy: el._cyreg.cy, onselect, onbackground, onmenu, onconnect, onannotate };
}

const shiftTap = (cy: Core, id: string) =>
	cy.getElementById(id).emit({ type: 'tap', originalEvent: new MouseEvent('click', { shiftKey: true }) } as never);

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

	it('connects the selected node to a Shift+clicked node', () => {
		const { cy, onselect, onconnect } = setup({ selectedId: 'n1' });
		shiftTap(cy, 'n2');
		expect(onconnect).toHaveBeenCalledWith('n1', 'n2');
		expect(onselect).not.toHaveBeenCalled();
	});

	it('treats Shift+click as a plain selection when nothing else is selected', () => {
		const { cy, onselect, onconnect } = setup();
		shiftTap(cy, 'n2');
		expect(onselect).toHaveBeenCalledWith('n2');
		expect(onconnect).not.toHaveBeenCalled();
	});

	it('does not connect a node to itself', () => {
		const { cy, onconnect } = setup({ selectedId: 'n1' });
		shiftTap(cy, 'n1');
		expect(onconnect).not.toHaveBeenCalled();
	});

	it('opens a focused annotation field when an unlabelled edge is clicked', async () => {
		const { cy, onannotate } = setup();
		cy.getElementById('bare').emit('tap');
		await tick();
		const input = screen.getByLabelText('Connection annotation');
		expect(input).toHaveFocus();
		await userEvent.type(input, ' rules {Enter}');
		expect(onannotate).toHaveBeenCalledWith('bare', 'rules');
		expect(screen.queryByLabelText('Connection annotation')).not.toBeInTheDocument();
	});

	it('closes the annotation field on Escape without saving', async () => {
		const { cy, onannotate } = setup();
		cy.getElementById('bare').emit('tap');
		await tick();
		await userEvent.type(screen.getByLabelText('Connection annotation'), 'oops{Escape}');
		expect(onannotate).not.toHaveBeenCalled();
		expect(screen.queryByLabelText('Connection annotation')).not.toBeInTheDocument();
	});

	it('leaves an edge that already has text alone', async () => {
		const { cy } = setup();
		cy.getElementById('named').emit('tap');
		await tick();
		expect(screen.queryByLabelText('Connection annotation')).not.toBeInTheDocument();
	});

	it('reports a right-click on empty canvas, with where it happened', () => {
		const { cy, onmenu, onbackground } = setup();
		cy.emit({ type: 'cxttap', renderedPosition: { x: 120, y: 80 } } as never);
		expect(onmenu).toHaveBeenCalledWith({ x: 120, y: 80 });
		expect(onbackground).not.toHaveBeenCalled();
	});

	it('ignores a right-click on a node', () => {
		const { cy, onmenu } = setup();
		cy.getElementById('n1').emit('cxttap');
		expect(onmenu).not.toHaveBeenCalled();
	});
});
