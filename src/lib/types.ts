// Row shapes mirroring supabase/migrations. Keep in sync with the schema.

export type Role = 'owner' | 'editor';

export interface Campaign {
	id: string;
	name: string;
	created_by: string;
	created_at: string;
}

export interface Profile {
	id: string;
	display_name: string;
}

export interface NodeType {
	id: string;
	campaign_id: string;
	label: string;
	color: string;
	icon: string | null;
	sort_order: number;
}

interface Tracked {
	id: string;
	campaign_id: string;
	session_number: number | null;
	version: number;
	created_by: string | null;
	created_at: string;
	updated_by: string | null;
	updated_at: string;
	deleted_at: string | null;
}

export interface LoreNode extends Tracked {
	type_id: string;
	name: string;
	aliases: string[];
	tags: string[];
	notes: string;
}

export interface LoreEdge extends Tracked {
	from_id: string;
	to_id: string;
	annotation: string;
}

export interface Revision {
	id: number;
	entity_type: 'node' | 'edge';
	entity_id: string;
	version: number;
	op: 'create' | 'update' | 'delete' | 'restore';
	snapshot: LoreNode | LoreEdge;
	changed_by: string | null;
	changed_at: string;
}
