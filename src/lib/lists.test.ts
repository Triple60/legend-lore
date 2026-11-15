import { describe, expect, it } from 'vitest';
import { splitList } from './lists';

describe('splitList', () => {
	it.each([
		['comma-space', 'The Devil, The Ancient', ['The Devil', 'The Ancient']],
		['bare commas', 'The Devil,The Ancient', ['The Devil', 'The Ancient']],
		['ragged spacing', '  The Devil ,   The Ancient  ', ['The Devil', 'The Ancient']],
		['single entry', 'Strahd', ['Strahd']]
	])('handles %s', (_label, input, expected) => {
		expect(splitList(input)).toEqual(expected);
	});

	it('keeps spaces inside an entry', () => {
		expect(splitList('Lord of Barovia')).toEqual(['Lord of Barovia']);
	});

	it('drops empty entries from stray or trailing commas', () => {
		expect(splitList('a,, b, ,c,')).toEqual(['a', 'b', 'c']);
	});

	it('returns an empty list for blank input, so the field is optional', () => {
		expect(splitList('')).toEqual([]);
		expect(splitList('   ')).toEqual([]);
		expect(splitList(' , , ')).toEqual([]);
	});
});
