import { describe, expect, it } from 'vitest';
import { makeEdge, makeNode } from '../tests/fixtures';
import { filterGraph } from './filter';

const place = makeNode({ id: 'village', type_id: 'place', session_number: 1 });
const person = makeNode({ id: 'ireena', type_id: 'person', session_number: 2 });
const later = makeNode({ id: 'vallaki', type_id: 'place', session_number: 5 });
const timeless = makeNode({ id: 'lore', type_id: 'lore', session_number: null });
const nodes = [place, person, later, timeless];

const e1 = makeEdge({ id: 'e1', from_id: 'ireena', to_id: 'village', session_number: 2 });
const e2 = makeEdge({ id: 'e2', from_id: 'ireena', to_id: 'vallaki', session_number: 5 });
const e3 = makeEdge({ id: 'e3', from_id: 'village', to_id: 'ireena', session_number: 4 });
const e4 = makeEdge({ id: 'e4', from_id: 'lore', to_id: 'village', session_number: null });
const edges = [e1, e2, e3, e4];

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('filterGraph', () => {
	it('shows everything with no filter', () => {
		const r = filterGraph(nodes, edges, { hiddenTypes: [], asOfSession: null });
		expect(ids(r.visibleNodes)).toEqual(ids(nodes));
		expect(ids(r.visibleEdges)).toEqual(ids(edges));
	});

	it('hides nodes of hidden types and their edges', () => {
		const r = filterGraph(nodes, edges, { hiddenTypes: ['person'], asOfSession: null });
		expect(ids(r.visibleNodes)).toEqual(['village', 'vallaki', 'lore']);
		expect(ids(r.visibleEdges)).toEqual(['e4']);
	});

	it('shows only what was known as of a session, inclusive', () => {
		const r = filterGraph(nodes, edges, { hiddenTypes: [], asOfSession: 2 });
		expect(ids(r.visibleNodes)).toEqual(['village', 'ireena', 'lore']);
		// e3 is between visible nodes but was learned in session 4.
		expect(ids(r.visibleEdges)).toEqual(['e1', 'e4']);
	});

	it('always shows things with no session number', () => {
		const r = filterGraph(nodes, edges, { hiddenTypes: [], asOfSession: 0 });
		expect(ids(r.visibleNodes)).toEqual(['lore']);
		expect(r.visibleEdges).toEqual([]);
	});
});
