import { describe, expect, it } from 'vitest';
import { makeNode } from '../tests/fixtures';
import { buildNameIndex, renderNotes } from './markdown';

const strahd = makeNode({ id: 'strahd', name: 'Strahd von Zarovich', aliases: ['The Devil'] });
const ireena = makeNode({ id: 'ireena', name: 'Ireena Kolyana' });
const index = buildNameIndex([strahd, ireena]);

describe('buildNameIndex', () => {
	it('indexes names and aliases, lower-cased', () => {
		expect(index.get('strahd von zarovich')).toBe('strahd');
		expect(index.get('the devil')).toBe('strahd');
		expect(index.get('ireena kolyana')).toBe('ireena');
	});

	it('keeps the first node when names collide', () => {
		const a = makeNode({ id: 'a', name: 'Twin' });
		const b = makeNode({ id: 'b', name: 'Other', aliases: ['twin'] });
		expect(buildNameIndex([a, b]).get('twin')).toBe('a');
	});

	it('skips blank aliases', () => {
		const n = makeNode({ id: 'n', name: 'N', aliases: ['  '] });
		expect([...buildNameIndex([n]).keys()]).toEqual(['n']);
	});
});

describe('renderNotes', () => {
	it('renders Markdown', () => {
		const html = renderNotes('**bold** and _italic_', index);
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('<em>italic</em>');
	});

	it('links [[Name]] to the matching node, ignoring case', () => {
		const html = renderNotes('Met [[ireena kolyana]].', index);
		expect(html).toContain('<a href="#node:ireena">ireena kolyana</a>');
	});

	it('links through an alias', () => {
		expect(renderNotes('Beware [[The Devil]]', index)).toContain('href="#node:strahd"');
	});

	it('uses the label in [[Name|label]]', () => {
		expect(renderNotes('[[Strahd von Zarovich|the Count]]', index)).toContain(
			'<a href="#node:strahd">the Count</a>'
		);
	});

	it('marks links to nodes that do not exist yet', () => {
		const html = renderNotes('Find [[Van Richten]]', index);
		expect(html).toContain('class="missing-link"');
		expect(html).toContain('Van Richten');
		expect(html).not.toContain('<a');
	});

	it('strips scripts and event handlers', () => {
		const html = renderNotes('<script>alert(1)</script><img src="x" onerror="alert(1)">\n\n[x](javascript:alert(1))', index);
		expect(html).not.toContain('<script');
		expect(html).not.toContain('onerror');
		expect(html).not.toMatch(/href="javascript:/i);
	});

	it('does not let a link label inject Markdown', () => {
		const html = renderNotes('[[Ireena Kolyana|a](javascript:alert(1)) [b]]', index);
		expect(html).not.toMatch(/href="javascript:/i);
	});
});
