import { describe, expect, it } from 'vitest';
import { createDemoClient } from './client.ts';
import { DEMO_USER } from './sample.ts';

type Rows = Record<string, unknown>[];

describe('demo client', () => {
	it('signs in as the demo user', async () => {
		const c = createDemoClient();
		const { data } = await c.auth.getSession();
		expect(data.session.user.id).toBe(DEMO_USER.id);
	});

	it('filters, orders, limits and picks columns', async () => {
		const c = createDemoClient();
		const { data } = await c.from('nodes').select('id, name').eq('type_id', 'object').order('name', { ascending: false }).limit(2);
		expect(data).toEqual([
			{ id: 'tome', name: 'Tome of Strahd' },
			{ id: 'sunsword', name: 'Sunsword' }
		]);
	});

	it('stamps new nodes like the database triggers do, and records a revision', async () => {
		const c = createDemoClient();
		const { data } = await c
			.from('nodes')
			.insert({ campaign_id: 'demo-barovia', type_id: 'place', name: 'Argynvostholt', aliases: [], tags: [' dragon ', 'dragon', ''], notes: '', session_number: 7 })
			.select()
			.single();
		const n = data as Record<string, unknown>;
		expect(n).toMatchObject({ version: 1, tags: ['dragon'], created_by: DEMO_USER.id, deleted_at: null });
		const { data: revs } = await c.from('revisions').select('*').eq('entity_id', n.id);
		expect((revs as Rows).map((r) => r.op)).toEqual(['create']);
	});

	it('bumps the version on update and rejects a stale one', async () => {
		const c = createDemoClient();
		const first = await c.from('nodes').update({ name: 'Strahd' }).eq('id', 'strahd').eq('version', 1).select();
		expect((first.data as Rows)[0]).toMatchObject({ name: 'Strahd', version: 2 });
		const stale = await c.from('nodes').update({ name: 'Nope' }).eq('id', 'strahd').eq('version', 1).select();
		expect(stale.data).toEqual([]);
	});

	it('records delete and restore in history', async () => {
		const c = createDemoClient();
		await c.from('nodes').update({ deleted_at: new Date().toISOString() }).eq('id', 'krezk').eq('version', 1).select();
		await c.from('nodes').update({ deleted_at: null }).eq('id', 'krezk').eq('version', 2).select();
		const { data } = await c.from('revisions').select('*').eq('entity_id', 'krezk').order('version', { ascending: false });
		expect((data as Rows).map((r) => r.op)).toEqual(['restore', 'delete', 'create']);
	});

	it('gives each new campaign the default node types', async () => {
		const c = createDemoClient();
		const { data } = await c.from('campaigns').insert({ name: 'Test' }).select().single();
		const types = await c.from('node_types').select('label').eq('campaign_id', (data as { id: string }).id);
		expect((types.data as Rows).map((t) => t.label)).toEqual(['Place', 'Person', 'Object', 'Lore']);
	});

	it('accepts its own invite links', async () => {
		const c = createDemoClient();
		const { data } = await c.from('campaign_invites').insert({ campaign_id: 'demo-barovia' }).select('token').single();
		const joined = await c.rpc('accept_invite', { invite_token: (data as { token: string }).token });
		expect(joined).toEqual({ data: 'demo-barovia', error: null });
		expect((await c.rpc('accept_invite', { invite_token: 'nope' })).error).not.toBeNull();
	});

	it('starts fresh each time', async () => {
		const a = createDemoClient();
		await a.from('nodes').update({ name: 'Changed' }).eq('id', 'strahd').select();
		const b = createDemoClient();
		const { data } = await b.from('nodes').select('name').eq('id', 'strahd').single();
		expect(data).toEqual({ name: 'Strahd von Zarovich' });
	});
});
