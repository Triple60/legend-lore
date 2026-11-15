import type { LoreEdge, LoreNode, NodeType } from '#lib/types.ts';

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

const tracked = {
	campaign_id: 'camp-1',
	session_number: null,
	version: 1,
	created_by: 'user-1',
	created_at: '2026-11-01T12:00:00Z',
	updated_by: 'user-1',
	updated_at: '2026-11-01T12:00:00Z',
	deleted_at: null
};

export function makeType(overrides: Partial<NodeType> = {}): NodeType {
	return {
		id: nextId('type'),
		campaign_id: 'camp-1',
		label: 'Person',
		color: '#e15759',
		icon: null,
		sort_order: 0,
		...overrides
	};
}

export function makeNode(overrides: Partial<LoreNode> = {}): LoreNode {
	return {
		...tracked,
		id: nextId('node'),
		type_id: 'type-person',
		name: 'Unnamed',
		aliases: [],
		tags: [],
		notes: '',
		...overrides
	};
}

export function makeEdge(overrides: Partial<LoreEdge> & Pick<LoreEdge, 'from_id' | 'to_id'>): LoreEdge {
	return { ...tracked, id: nextId('edge'), annotation: '', ...overrides };
}
