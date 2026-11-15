import { describe, expect, it } from 'vitest';
import { makeNode } from '../tests/fixtures';
import { searchNodes } from './search';

const strahd = makeNode({
	name: 'Strahd von Zarovich',
	aliases: ['The Devil', 'The Ancient'],
	tags: ['vampire', 'villain'],
	notes: 'Lord of Castle Ravenloft.'
});
const ireena = makeNode({ name: 'Ireena Kolyana', tags: ['barovia', 'ally'], notes: 'Hunted by Strahd.' });
const ravenloft = makeNode({ name: 'Castle Ravenloft', tags: ['barovia', 'castle'] });
const all = [strahd, ireena, ravenloft];

const names = (q: string) => searchNodes(all, q).map((h) => h.node.name);

describe('searchNodes', () => {
	it('returns nothing for an empty or blank query', () => {
		expect(searchNodes(all, '')).toEqual([]);
		expect(searchNodes(all, '   ')).toEqual([]);
	});

	it('is case-insensitive', () => {
		expect(names('IREENA')).toEqual(['Ireena Kolyana']);
	});

	it('ranks a name match above a notes match', () => {
		// "strahd" is Strahd's name but only in Ireena's notes.
		const hits = searchNodes(all, 'strahd');
		expect(hits.map((h) => [h.node.name, h.why])).toEqual([
			['Strahd von Zarovich', 'name'],
			['Ireena Kolyana', 'notes']
		]);
	});

	it('ranks exact > prefix > substring name matches', () => {
		const a = makeNode({ name: 'Ravenloft' });
		const b = makeNode({ name: 'Ravenloft Gate' });
		const c = makeNode({ name: 'Castle Ravenloft' });
		const hits = searchNodes([c, b, a], 'ravenloft');
		expect(hits.map((h) => h.node.name)).toEqual(['Ravenloft', 'Ravenloft Gate', 'Castle Ravenloft']);
	});

	it('matches aliases', () => {
		const [hit] = searchNodes(all, 'devil');
		expect(hit.node).toBe(strahd);
		expect(hit.why).toBe('alias');
	});

	it('matches tag text as a plain word', () => {
		const [hit] = searchNodes(all, 'vamp');
		expect(hit.node).toBe(strahd);
		expect(hit.why).toBe('tag');
	});

	it('requires every word to match somewhere', () => {
		expect(names('castle ravenloft')).toEqual(['Castle Ravenloft', 'Strahd von Zarovich']);
		expect(names('castle dragon')).toEqual([]);
	});

	it('filters by #tag exactly, case-insensitively', () => {
		expect(names('#barovia')).toEqual(['Castle Ravenloft', 'Ireena Kolyana']);
		expect(names('#BAROVIA')).toEqual(['Castle Ravenloft', 'Ireena Kolyana']);
		// A partial tag is not a tag match.
		expect(names('#baro')).toEqual([]);
	});

	it('combines #tags with words', () => {
		expect(names('#barovia ireena')).toEqual(['Ireena Kolyana']);
	});

	it('ignores a lone "#"', () => {
		expect(names('#')).toEqual([]);
	});

	it('breaks score ties alphabetically and respects the limit', () => {
		const nodes = ['Charlie', 'Alpha', 'Bravo'].map((name) => makeNode({ name, tags: ['x'] }));
		expect(searchNodes(nodes, '#x').map((h) => h.node.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
		expect(searchNodes(nodes, '#x', 2)).toHaveLength(2);
	});
});
