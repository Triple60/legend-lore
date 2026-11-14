import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { LoreNode } from './types';

/** Map lower-cased names and aliases to node ids, for [[wiki links]]. */
export function buildNameIndex(nodes: LoreNode[]): Map<string, string> {
	const index = new Map<string, string>();
	for (const n of nodes) {
		for (const name of [n.name, ...n.aliases]) {
			const key = name.trim().toLowerCase();
			if (key && !index.has(key)) index.set(key, n.id);
		}
	}
	return index;
}

const escapeMd = (s: string) => s.replace(/[[\]\\]/g, '\\$&');

/**
 * Render notes as sanitized HTML. `[[Name]]` and `[[Name|shown text]]` become
 * links to the matching node (`#node:<id>`), or a "missing" marker when no
 * node of that name or alias exists yet.
 */
export function renderNotes(notes: string, index: Map<string, string>): string {
	const linked = notes.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, label?: string) => {
		const text = escapeMd((label ?? target).trim());
		const id = index.get(target.trim().toLowerCase());
		return id ? `[${text}](#node:${id})` : `<span class="missing-link" title="No node named this yet">${text}</span>`;
	});
	const html = marked.parse(linked, { async: false, gfm: true, breaks: true });
	return DOMPurify.sanitize(html);
}
