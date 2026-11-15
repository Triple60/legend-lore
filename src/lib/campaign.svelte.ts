import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Campaign, LoreEdge, LoreNode, NodeType, Profile, Revision } from './types';

export type NodeInput = Pick<LoreNode, 'name' | 'type_id' | 'aliases' | 'tags' | 'notes' | 'session_number'>;
export type EdgeInput = Pick<LoreEdge, 'from_id' | 'to_id' | 'annotation' | 'session_number'>;

interface PresenceMeta {
	user_id: string;
	name: string;
	editing: string | null;
	since: number;
}

export class ConflictError extends Error {
	constructor() {
		super('Someone else changed this since you opened it. Reload it and try again.');
	}
}

function fail(error: { message: string } | null): asserts error is null {
	if (error) throw new Error(error.message);
}

/**
 * Everything the campaign page needs: the loaded graph, live updates from
 * other players, and "who is editing what" locks via Supabase Presence.
 *
 * Locks are advisory and live only in presence, so they vanish automatically
 * when a tab closes or a laptop sleeps. Saves additionally check `version`,
 * so even a lost race can't silently overwrite someone else's edit.
 */
export class CampaignStore {
	campaign = $state<Campaign | null>(null);
	types = $state<Record<string, NodeType>>({});
	nodes = $state<Record<string, LoreNode>>({});
	edges = $state<Record<string, LoreEdge>>({});
	profiles = $state<Record<string, Profile>>({});
	online = $state<PresenceMeta[]>([]);
	editing = $state<string | null>(null);
	lostLockTo = $state<string | null>(null);
	error = $state<string | null>(null);
	loading = $state(true);

	private channel: RealtimeChannel | null = null;
	private destroyed = false;
	private editingSince = 0;

	constructor(
		readonly id: string,
		private readonly me: { id: string; name: string }
	) {}

	/** Live (not soft-deleted) nodes. */
	get liveNodes(): LoreNode[] {
		return Object.values(this.nodes).filter((n) => !n.deleted_at);
	}

	/** Live edges whose endpoints are both live. */
	get liveEdges(): LoreEdge[] {
		return Object.values(this.edges).filter(
			(e) => !e.deleted_at && this.isLive(e.from_id) && this.isLive(e.to_id)
		);
	}

	get trashedNodes(): LoreNode[] {
		return Object.values(this.nodes)
			.filter((n) => n.deleted_at)
			.sort((a, b) => (b.deleted_at ?? '').localeCompare(a.deleted_at ?? ''));
	}

	get sortedTypes(): NodeType[] {
		return Object.values(this.types).sort((a, b) => a.sort_order - b.sort_order);
	}

	get allTags(): string[] {
		const tags = new Set<string>();
		for (const n of this.liveNodes) for (const t of n.tags) tags.add(t);
		return [...tags].sort((a, b) => a.localeCompare(b));
	}

	isLive(nodeId: string) {
		const n = this.nodes[nodeId];
		return Boolean(n && !n.deleted_at);
	}

	nameOf(userId: string | null) {
		return (userId && this.profiles[userId]?.display_name) || 'someone';
	}

	async load() {
		this.loading = true;
		try {
			const [campaign, types, nodes, edges, profiles] = await Promise.all([
				supabase.from('campaigns').select('*').eq('id', this.id).maybeSingle(),
				supabase.from('node_types').select('*').eq('campaign_id', this.id),
				supabase.from('nodes').select('*').eq('campaign_id', this.id),
				supabase.from('edges').select('*').eq('campaign_id', this.id),
				supabase.from('profiles').select('id, display_name')
			]);
			for (const r of [campaign, types, nodes, edges, profiles]) fail(r.error);
			if (!campaign.data) throw new Error('Campaign not found, or you are not a member.');

			this.campaign = campaign.data;
			this.types = byId(types.data as NodeType[]);
			this.nodes = byId(nodes.data as LoreNode[]);
			this.edges = byId(edges.data as LoreEdge[]);
			this.profiles = byId(profiles.data as Profile[]);
			await this.subscribe();
		} catch (e) {
			this.error = (e as Error).message;
		} finally {
			this.loading = false;
		}
	}

	private async subscribe() {
		if (this.destroyed) return;
		const topic = `campaign:${this.id}`;
		// supabase.channel() hands back an existing channel with the same topic,
		// which can't take new listeners, so clear out any leftover one first.
		for (const old of supabase.getChannels()) {
			if (old.topic === `realtime:${topic}`) await supabase.removeChannel(old);
		}
		if (this.destroyed) return;

		const filter = `campaign_id=eq.${this.id}`;
		const channel = supabase.channel(topic, {
			config: { presence: { key: crypto.randomUUID() } }
		});

		channel
			.on('postgres_changes', { event: '*', schema: 'public', table: 'nodes', filter }, (p) => {
				if (p.new && 'id' in p.new) this.mergeNode(p.new as LoreNode);
			})
			.on('postgres_changes', { event: '*', schema: 'public', table: 'edges', filter }, (p) => {
				if (p.new && 'id' in p.new) this.mergeEdge(p.new as LoreEdge);
			})
			.on('postgres_changes', { event: '*', schema: 'public', table: 'node_types', filter }, (p) => {
				if (p.eventType === 'DELETE') {
					const old = p.old as Partial<NodeType>;
					if (old.id) delete this.types[old.id];
				} else {
					const t = p.new as NodeType;
					this.types[t.id] = t;
				}
			})
			.on('presence', { event: 'sync' }, () => this.onPresenceSync())
			.subscribe((status) => {
				if (status === 'SUBSCRIBED') this.trackPresence();
			});

		this.channel = channel;
	}

	// Ignore stale realtime events that arrive after our own newer write.
	private mergeNode(n: LoreNode) {
		const cur = this.nodes[n.id];
		if (!cur || n.version >= cur.version) this.nodes[n.id] = n;
	}

	private mergeEdge(e: LoreEdge) {
		const cur = this.edges[e.id];
		if (!cur || e.version >= cur.version) this.edges[e.id] = e;
	}

	private trackPresence() {
		const meta: PresenceMeta = {
			user_id: this.me.id,
			name: this.me.name,
			editing: this.editing,
			since: this.editingSince
		};
		return this.channel?.track(meta);
	}

	private onPresenceSync() {
		const state = this.channel?.presenceState<PresenceMeta>() ?? {};
		this.online = Object.values(state).flat();

		// If two people grabbed the same node at once, the earlier one keeps it.
		if (this.editing) {
			const winner = this.lockHolder(this.editing);
			if (winner) {
				this.lostLockTo = winner.name;
				this.editing = null;
				this.trackPresence();
			}
		}
	}

	/** Another session that holds (or out-ranks us for) the lock on this node. */
	lockHolder(nodeId: string): PresenceMeta | null {
		const mine = this.editing === nodeId ? this.editingSince : Infinity;
		const others = this.online.filter(
			(p) => p.editing === nodeId && !(p.user_id === this.me.id && p.since === this.editingSince)
		);
		return others.find((p) => p.since < mine || (p.since === mine && p.user_id < this.me.id)) ?? null;
	}

	async beginEdit(nodeId: string): Promise<boolean> {
		if (this.lockHolder(nodeId)) return false;
		this.lostLockTo = null;
		this.editing = nodeId;
		this.editingSince = Date.now();
		await this.trackPresence();
		return true;
	}

	async endEdit() {
		this.editing = null;
		this.editingSince = 0;
		await this.trackPresence();
	}

	// --- Nodes -------------------------------------------------------------

	async createNode(input: NodeInput): Promise<LoreNode> {
		const { data, error } = await supabase
			.from('nodes')
			.insert({ ...input, campaign_id: this.id })
			.select()
			.single();
		fail(error);
		this.mergeNode(data);
		return data;
	}

	async updateNode(node: LoreNode, patch: Partial<LoreNode>): Promise<LoreNode> {
		const { data, error } = await supabase
			.from('nodes')
			.update(patch)
			.eq('id', node.id)
			.eq('version', node.version)
			.select();
		fail(error);
		if (!data.length) throw new ConflictError();
		this.mergeNode(data[0]);
		return data[0];
	}

	deleteNode(node: LoreNode) {
		return this.updateNode(node, { deleted_at: new Date().toISOString() });
	}

	restoreNode(node: LoreNode) {
		return this.updateNode(node, { deleted_at: null });
	}

	// --- Edges -------------------------------------------------------------

	async createEdge(input: EdgeInput): Promise<LoreEdge> {
		const { data, error } = await supabase
			.from('edges')
			.insert({ ...input, campaign_id: this.id })
			.select()
			.single();
		fail(error);
		this.mergeEdge(data);
		return data;
	}

	async updateEdge(edge: LoreEdge, patch: Partial<LoreEdge>): Promise<LoreEdge> {
		const { data, error } = await supabase
			.from('edges')
			.update(patch)
			.eq('id', edge.id)
			.eq('version', edge.version)
			.select();
		fail(error);
		if (!data.length) throw new ConflictError();
		this.mergeEdge(data[0]);
		return data[0];
	}

	deleteEdge(edge: LoreEdge) {
		return this.updateEdge(edge, { deleted_at: new Date().toISOString() });
	}

	// --- Types, history, invites -------------------------------------------

	async createType(label: string, color: string) {
		const sort_order = Math.max(-1, ...this.sortedTypes.map((t) => t.sort_order)) + 1;
		const { data, error } = await supabase
			.from('node_types')
			.insert({ campaign_id: this.id, label, color, sort_order })
			.select()
			.single();
		fail(error);
		this.types[data.id] = data;
	}

	/** Rename or recolour a node type (any type, including the starting four). */
	async updateType(type: NodeType, patch: Partial<Pick<NodeType, 'label' | 'color'>>) {
		const { data, error } = await supabase.from('node_types').update(patch).eq('id', type.id).select().single();
		fail(error);
		this.types[data.id] = data;
	}

	async history(entityId: string): Promise<Revision[]> {
		const { data, error } = await supabase
			.from('revisions')
			.select('*')
			.eq('entity_id', entityId)
			.order('version', { ascending: false })
			.limit(100);
		fail(error);
		return data as Revision[];
	}

	/** Undo = write an old snapshot's content back as a new version. */
	restoreRevision(node: LoreNode, rev: Revision) {
		const s = rev.snapshot as LoreNode;
		return this.updateNode(node, {
			name: s.name,
			type_id: s.type_id,
			aliases: s.aliases,
			tags: s.tags,
			notes: s.notes,
			session_number: s.session_number,
			deleted_at: s.deleted_at
		});
	}

	async createInvite(): Promise<string> {
		const { data, error } = await supabase
			.from('campaign_invites')
			.insert({ campaign_id: this.id })
			.select('token')
			.single();
		fail(error);
		return data.token;
	}

	destroy() {
		this.destroyed = true;
		if (this.channel) supabase.removeChannel(this.channel);
		this.channel = null;
	}
}

function byId<T extends { id: string }>(rows: T[]): Record<string, T> {
	return Object.fromEntries(rows.map((r) => [r.id, r]));
}
