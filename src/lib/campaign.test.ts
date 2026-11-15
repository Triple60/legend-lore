import { beforeEach, describe, expect, it, vi } from 'vitest';
import { arg, createFakeSupabase } from '../tests/fake-supabase';
import { makeEdge, makeNode, makeType } from '../tests/fixtures';

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createFakeSupabase> | null }));
vi.mock('./supabase', async () => {
	const { createFakeSupabase } = await import('../tests/fake-supabase');
	fake.current = createFakeSupabase();
	return { supabase: fake.current.client, isConfigured: true };
});

const { CampaignStore, ConflictError } = await import('./campaign.svelte');
const sb = fake.current!;
const me = { id: 'user-me', name: 'Me' };

beforeEach(() => sb.reset());

function storeWith({ nodes = [], edges = [], types = [] }: { nodes?: any[]; edges?: any[]; types?: any[] } = {}) {
	const s = new CampaignStore('camp-1', me);
	s.nodes = Object.fromEntries(nodes.map((n) => [n.id, n]));
	s.edges = Object.fromEntries(edges.map((e) => [e.id, e]));
	s.types = Object.fromEntries(types.map((t) => [t.id, t]));
	return s;
}

describe('derived views', () => {
	const a = makeNode({ id: 'a', name: 'A', tags: ['zeta', 'alpha'] });
	const b = makeNode({ id: 'b', name: 'B', tags: ['alpha'] });
	const gone = makeNode({ id: 'gone', name: 'Gone', tags: ['trashed'], deleted_at: '2026-11-02T00:00:00Z' });
	const older = makeNode({ id: 'older', deleted_at: '2026-11-01T00:00:00Z' });
	const ab = makeEdge({ id: 'ab', from_id: 'a', to_id: 'b' });
	const toGone = makeEdge({ id: 'toGone', from_id: 'a', to_id: 'gone' });
	const deletedEdge = makeEdge({ id: 'deleted', from_id: 'a', to_id: 'b', deleted_at: '2026-11-02T00:00:00Z' });
	const s = storeWith({ nodes: [a, b, gone, older], edges: [ab, toGone, deletedEdge] });

	it('liveNodes leaves out trashed nodes', () => {
		expect(s.liveNodes.map((n) => n.id)).toEqual(['a', 'b']);
	});

	it('liveEdges leaves out deleted edges and edges to trashed nodes', () => {
		expect(s.liveEdges.map((e) => e.id)).toEqual(['ab']);
	});

	it('trashedNodes lists the most recently deleted first', () => {
		expect(s.trashedNodes.map((n) => n.id)).toEqual(['gone', 'older']);
	});

	it('allTags is sorted, de-duplicated, and from live nodes only', () => {
		expect(s.allTags).toEqual(['alpha', 'zeta']);
	});

	it('sortedTypes follows sort_order', () => {
		const t = storeWith({
			types: [makeType({ id: 'x', sort_order: 2 }), makeType({ id: 'y', sort_order: 0 }), makeType({ id: 'z', sort_order: 1 })]
		});
		expect(t.sortedTypes.map((x) => x.id)).toEqual(['y', 'z', 'x']);
	});

	it('nameOf falls back to "someone"', () => {
		const t = storeWith();
		t.profiles = { u1: { id: 'u1', display_name: 'Alice' } };
		expect(t.nameOf('u1')).toBe('Alice');
		expect(t.nameOf('nobody')).toBe('someone');
		expect(t.nameOf(null)).toBe('someone');
	});
});

describe('load', () => {
	it('loads the campaign and indexes rows by id', async () => {
		const node = makeNode({ id: 'n1' });
		sb.respondWith((q) => {
			if (q.table === 'campaigns') return { data: { id: 'camp-1', name: 'Curse' }, error: null };
			if (q.table === 'nodes') return { data: [node], error: null };
			return { data: [], error: null };
		});
		const s = new CampaignStore('camp-1', me);
		await s.load();
		expect(s.error).toBeNull();
		expect(s.loading).toBe(false);
		expect(s.campaign?.name).toBe('Curse');
		expect(s.nodes).toEqual({ n1: node });
		expect(sb.client.channel).toHaveBeenCalled();
	});

	it('reports a campaign you cannot see', async () => {
		sb.respondWith((q) => ({ data: q.table === 'campaigns' ? null : [], error: null }));
		const s = new CampaignStore('camp-1', me);
		await s.load();
		expect(s.error).toMatch(/not found/i);
		expect(s.loading).toBe(false);
	});

	it('reports database errors', async () => {
		sb.respondWith(() => ({ data: null, error: { message: 'permission denied' } }));
		const s = new CampaignStore('camp-1', me);
		await s.load();
		expect(s.error).toBe('permission denied');
	});
});

describe('nodes', () => {
	it('createNode inserts into this campaign and stores the result', async () => {
		const saved = makeNode({ id: 'new', name: 'Strahd' });
		sb.respondWith(() => ({ data: saved, error: null }));
		const s = storeWith();
		const input = { name: 'Strahd', type_id: 't', aliases: [], tags: [], notes: '', session_number: 3 };
		await s.createNode(input);
		expect(arg(sb.queries[0], 'insert')).toEqual({ ...input, campaign_id: 'camp-1' });
		expect(s.nodes.new).toEqual(saved);
	});

	it('createNode surfaces database errors', async () => {
		sb.respondWith(() => ({ data: null, error: { message: 'violates check constraint' } }));
		await expect(storeWith().createNode({} as any)).rejects.toThrow('violates check constraint');
	});

	it('updateNode only writes if the version is unchanged', async () => {
		const node = makeNode({ id: 'n', version: 4 });
		sb.respondWith(() => ({ data: [{ ...node, name: 'New', version: 5 }], error: null }));
		const s = storeWith({ nodes: [node] });
		await s.updateNode(node, { name: 'New' });
		expect(sb.queries[0].ops).toContainEqual(['eq', 'version', 4]);
		expect(s.nodes.n.version).toBe(5);
	});

	it('updateNode throws a ConflictError when someone else saved first', async () => {
		const node = makeNode({ id: 'n', version: 4 });
		sb.respondWith(() => ({ data: [], error: null }));
		await expect(storeWith({ nodes: [node] }).updateNode(node, { name: 'x' })).rejects.toBeInstanceOf(ConflictError);
	});

	it('deleteNode is a soft delete and restoreNode clears it', async () => {
		const node = makeNode({ id: 'n' });
		sb.respondWith(() => ({ data: [node], error: null }));
		const s = storeWith({ nodes: [node] });
		await s.deleteNode(node);
		expect(arg(sb.queries[0], 'update')).toEqual({ deleted_at: expect.any(String) });
		await s.restoreNode(node);
		expect(arg(sb.queries[1], 'update')).toEqual({ deleted_at: null });
	});

	it('restoreRevision writes the snapshot content back', async () => {
		const node = makeNode({ id: 'n', version: 3 });
		const snapshot = makeNode({ id: 'n', name: 'Old name', aliases: ['A'], tags: ['t'], notes: 'old', session_number: 1 });
		sb.respondWith(() => ({ data: [node], error: null }));
		await storeWith({ nodes: [node] }).restoreRevision(node, { snapshot, version: 1 } as any);
		expect(arg(sb.queries[0], 'update')).toEqual({
			name: 'Old name',
			type_id: snapshot.type_id,
			aliases: ['A'],
			tags: ['t'],
			notes: 'old',
			session_number: 1,
			deleted_at: null
		});
	});
});

describe('edges', () => {
	it('createEdge inserts into this campaign', async () => {
		const saved = makeEdge({ id: 'e', from_id: 'a', to_id: 'b', session_number: 2 });
		sb.respondWith(() => ({ data: saved, error: null }));
		const s = storeWith();
		await s.createEdge({ from_id: 'a', to_id: 'b', annotation: 'rules', session_number: 2 });
		expect(arg(sb.queries[0], 'insert')).toMatchObject({ campaign_id: 'camp-1', session_number: 2 });
		expect(s.edges.e).toEqual(saved);
	});

	it('updateEdge throws a ConflictError on a stale version', async () => {
		const edge = makeEdge({ id: 'e', from_id: 'a', to_id: 'b' });
		sb.respondWith(() => ({ data: [], error: null }));
		await expect(storeWith().updateEdge(edge, { annotation: 'x' })).rejects.toBeInstanceOf(ConflictError);
	});
});

describe('createType', () => {
	it('appends the new type after the existing ones', async () => {
		const s = storeWith({ types: [makeType({ sort_order: 0 }), makeType({ sort_order: 3 })] });
		sb.respondWith((q) => ({ data: { ...(arg(q, 'insert') as object), id: 'new-type' }, error: null }));
		await s.createType('Faction', '#123456');
		expect(arg(sb.queries[0], 'insert')).toEqual({ campaign_id: 'camp-1', label: 'Faction', color: '#123456', sort_order: 4 });
		expect(s.types['new-type'].label).toBe('Faction');
	});

	it('starts at 0 in an empty campaign', async () => {
		sb.respondWith((q) => ({ data: { ...(arg(q, 'insert') as object), id: 't' }, error: null }));
		await storeWith().createType('Faction', '#123456');
		expect(arg(sb.queries[0], 'insert')).toMatchObject({ sort_order: 0 });
	});

	it('surfaces duplicate-label errors', async () => {
		sb.respondWith(() => ({ data: null, error: { message: 'duplicate key value' } }));
		await expect(storeWith().createType('Place', '#123456')).rejects.toThrow('duplicate key');
	});
});

describe('edit locks', () => {
	const other = (since: number, user_id = 'user-other') => ({ user_id, name: 'Other', editing: 'n', since });

	it('lets you take a free lock', async () => {
		const s = storeWith();
		expect(await s.beginEdit('n')).toBe(true);
		expect(s.editing).toBe('n');
	});

	it('refuses a lock someone else holds', async () => {
		const s = storeWith();
		s.online = [other(100)];
		expect(s.lockHolder('n')?.name).toBe('Other');
		expect(await s.beginEdit('n')).toBe(false);
		expect(s.editing).toBeNull();
	});

	it('the earlier editor wins a race', async () => {
		const s = storeWith();
		await s.beginEdit('n');
		const mine = Date.now();
		s.online = [other(mine + 1000)];
		expect(s.lockHolder('n')).toBeNull();
		s.online = [other(mine - 1000)];
		expect(s.lockHolder('n')?.name).toBe('Other');
	});

	it('ignores your own presence entry', async () => {
		const s = storeWith();
		await s.beginEdit('n');
		s.online = [{ user_id: me.id, name: me.name, editing: 'n', since: (s as any).editingSince }];
		expect(s.lockHolder('n')).toBeNull();
	});

	it('endEdit releases the lock', async () => {
		const s = storeWith();
		await s.beginEdit('n');
		await s.endEdit();
		expect(s.editing).toBeNull();
	});
});
