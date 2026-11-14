import type { LoreNode } from './types';

export interface SearchHit {
	node: LoreNode;
	score: number;
	why: string;
}

/**
 * Small client-side ranked search. The whole campaign is in memory, which is
 * fine up to several thousand nodes. `#tag` terms must match a tag exactly
 * (case-insensitive); other words match name, aliases, tags, then notes.
 */
export function searchNodes(nodes: LoreNode[], query: string, limit = 20): SearchHit[] {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!terms.length) return [];
	const tagTerms = terms.filter((t) => t.startsWith('#') && t.length > 1).map((t) => t.slice(1));
	const words = terms.filter((t) => !t.startsWith('#'));

	const hits: SearchHit[] = [];
	for (const node of nodes) {
		const tags = node.tags.map((t) => t.toLowerCase());
		if (!tagTerms.every((t) => tags.includes(t))) continue;

		const name = node.name.toLowerCase();
		const aliases = node.aliases.map((a) => a.toLowerCase());
		const notes = node.notes.toLowerCase();
		let score = tagTerms.length ? 1 : 0;
		let why = tagTerms.length ? 'tag' : '';
		let ok = true;

		for (const w of words) {
			if (name === w) [score, why] = [score + 100, why || 'name'];
			else if (name.startsWith(w)) [score, why] = [score + 60, why || 'name'];
			else if (name.includes(w)) [score, why] = [score + 40, why || 'name'];
			else if (aliases.some((a) => a.includes(w))) [score, why] = [score + 30, why || 'alias'];
			else if (tags.some((t) => t.includes(w))) [score, why] = [score + 20, why || 'tag'];
			else if (notes.includes(w)) [score, why] = [score + 5, why || 'notes'];
			else {
				ok = false;
				break;
			}
		}
		if (ok && score > 0) hits.push({ node, score, why });
	}
	return hits.sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name)).slice(0, limit);
}
