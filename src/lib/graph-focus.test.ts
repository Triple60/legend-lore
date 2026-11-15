import cytoscape from 'cytoscape';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyGraphFocus } from './graph-focus';

//   lonely      a ── b ── c
//               └─── d ───┘   (a→d, d→c)
let cy: cytoscape.Core;
beforeEach(() => {
	cy = cytoscape({
		headless: true,
		elements: [
			...['a', 'b', 'c', 'd', 'lonely'].map((id) => ({ data: { id } })),
			{ data: { id: 'ab', source: 'a', target: 'b' } },
			{ data: { id: 'bc', source: 'b', target: 'c' } },
			{ data: { id: 'ad', source: 'a', target: 'd' } },
			{ data: { id: 'dc', source: 'd', target: 'c' } }
		]
	});
});

const withClass = (cls: string) =>
	cy
		.elements(`.${cls}`)
		.map((el) => el.id())
		.sort();

describe('applyGraphFocus', () => {
	it('does nothing with no selection and no search', () => {
		applyGraphFocus(cy, null, null);
		expect(withClass('faded')).toEqual([]);
		expect(withClass('selected')).toEqual([]);
		expect(withClass('connected')).toEqual([]);
	});

	it('highlights a selected node’s connections and neighbours, and fades the rest', () => {
		applyGraphFocus(cy, 'b', null);
		expect(withClass('selected')).toEqual(['b']);
		expect(withClass('connected')).toEqual(['ab', 'bc']);
		// a and c are neighbours, but the a→d→c path doesn't touch b.
		expect(withClass('faded')).toEqual(['ad', 'd', 'dc', 'lonely']);
	});

	it('follows connections in both directions', () => {
		applyGraphFocus(cy, 'c', null);
		expect(withClass('connected')).toEqual(['bc', 'dc']);
		expect(withClass('faded')).toEqual(['a', 'ab', 'ad', 'lonely']);
	});

	it('fades everything else around an unconnected node', () => {
		applyGraphFocus(cy, 'lonely', null);
		expect(withClass('connected')).toEqual([]);
		expect(withClass('faded')).toEqual(['a', 'ab', 'ad', 'b', 'bc', 'c', 'd', 'dc']);
	});

	it('lets a search decide what fades, while still marking the selection', () => {
		applyGraphFocus(cy, 'b', new Set(['a', 'd', 'b']));
		expect(withClass('faded')).toEqual(['bc', 'c', 'dc', 'lonely']);
		expect(withClass('selected')).toEqual(['b']);
		expect(withClass('connected')).toEqual(['ab', 'bc']);
	});

	it('clears everything when the selection is removed', () => {
		applyGraphFocus(cy, 'b', null);
		applyGraphFocus(cy, null, null);
		expect(withClass('faded')).toEqual([]);
		expect(withClass('selected')).toEqual([]);
		expect(withClass('connected')).toEqual([]);
	});

	it('ignores a selected id that is not in the graph (e.g. filtered out)', () => {
		applyGraphFocus(cy, 'missing', null);
		expect(withClass('faded')).toEqual([]);
		expect(withClass('connected')).toEqual([]);
	});
});
