import type { LoreNode } from './types';

export interface SearchHit {
	node: LoreNode;
	score: number;
	why: string;
	/** A short excerpt to show under the name, with the matched words marked. */
	preview: Segment[];
}

/** A run of preview text; `hit` runs are the words that matched. */
export interface Segment {
	text: string;
	hit: boolean;
}

/** Notes as one line of plain text: wiki links show their label, Markdown marks go. */
export function plainText(md: string): string {
	return md
		.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, label?: string) => (label ?? target).trim())
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
		.replace(/[*_`~]+/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Split `text` into segments, marking every occurrence of any of `words`. */
export function markWords(text: string, words: string[]): Segment[] {
	const terms = words.filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	if (!terms.length) return text ? [{ text, hit: false }] : [];
	const out: Segment[] = [];
	const re = new RegExp(terms.join('|'), 'gi');
	let last = 0;
	for (const m of text.matchAll(re)) {
		if (m.index > last) out.push({ text: text.slice(last, m.index), hit: false });
		out.push({ text: m[0], hit: true });
		last = m.index + m[0].length;
	}
	if (last < text.length) out.push({ text: text.slice(last), hit: false });
	return out;
}

/**
 * A window of about `width` characters of `text`, centred on the first match
 * of any word (or the start, when nothing matches), cut at word boundaries.
 */
export function excerpt(text: string, words: string[], width = 110): Segment[] {
	const lower = text.toLowerCase();
	const first = Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0));
	let start = Number.isFinite(first) ? Math.max(0, first - Math.floor(width / 3)) : 0;
	let end = Math.min(text.length, start + width);
	start = Math.max(0, end - width);
	if (start > 0) start = text.indexOf(' ', start) + 1 || start;
	if (end < text.length) end = text.lastIndexOf(' ', end) > start ? text.lastIndexOf(' ', end) : end;
	const body = text.slice(start, end).trim();
	const segs = markWords(body, words);
	if (start > 0) segs.unshift({ text: '… ', hit: false });
	if (end < text.length) segs.push({ text: ' …', hit: false });
	return segs;
}

function previewFor(node: LoreNode, words: string[], why: string): Segment[] {
	if (why === 'alias') {
		const alias = node.aliases.find((a) => words.some((w) => a.toLowerCase().includes(w)));
		if (alias) return [{ text: 'a.k.a. ', hit: false }, ...markWords(alias, words)];
	}
	const notes = plainText(node.notes);
	if (notes) return excerpt(notes, words);
	if (node.tags.length) return markWords(node.tags.map((t) => `#${t}`).join(' '), words);
	return [];
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
		if (ok && score > 0) hits.push({ node, score, why, preview: [] });
	}
	const top = hits.sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name)).slice(0, limit);
	// Only the hits that will be shown need an excerpt.
	for (const h of top) h.preview = previewFor(h.node, words, h.why);
	return top;
}
