import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from './harness';

// Data rules enforced by triggers and constraints: cleanup of names, tags and
// aliases; server-side stamps and versions; and the revision history.

let db: Db;
let alice: string;
let bob: string;
let camp: Awaited<ReturnType<Db['createCampaign']>>;

beforeAll(async () => {
	db = await createDb();
	alice = await db.createUser();
	bob = await db.createUser();
	camp = await db.createCampaign(alice);
	await db.join(camp.id, alice, bob);
});

const person = () => camp.typeId('Person');

describe('node cleanup', () => {
	it('trims the name', async () => {
		const n = await db.createNode(alice, camp.id, person(), { name: '  Strahd  ' });
		expect(n.name).toBe('Strahd');
	});

	it('trims tags and aliases, and drops blanks and duplicates in order', async () => {
		const n = await db.createNode(alice, camp.id, person(), {
			aliases: [' The Devil', 'The Ancient ', '', '  ', 'The Devil'],
			tags: ['vampire', ' vampire ', 'villain']
		});
		expect(n.aliases).toEqual(['The Devil', 'The Ancient']);
		expect(n.tags).toEqual(['vampire', 'villain']);
	});

	it('keeps spaces inside an alias', async () => {
		const n = await db.createNode(alice, camp.id, person(), { aliases: ['Lord of Barovia'] });
		expect(n.aliases).toEqual(['Lord of Barovia']);
	});

	it('makes aliases, tags, notes and session optional', async () => {
		const n = await db.createNode(alice, camp.id, person(), { name: 'Minimal' });
		expect(n).toMatchObject({ aliases: [], tags: [], notes: '', session_number: null });
	});

	it('also cleans up on update', async () => {
		const n = await db.createNode(alice, camp.id, person());
		const updated = await db.as(alice, () =>
			db.one('update nodes set aliases = $1, name = $2 where id = $3 returning *', [['  x ', 'x', ''], ' Renamed ', n.id])
		);
		expect(updated.aliases).toEqual(['x']);
		expect(updated.name).toBe('Renamed');
	});
});

describe('node constraints', () => {
	it.each([
		['a blank name', { name: '   ' }],
		['a name over 200 characters', { name: 'x'.repeat(201) }],
		['a negative session', { session_number: -1 }]
	])('rejects %s', async (_label, fields) => {
		await expect(db.createNode(alice, camp.id, person(), fields)).rejects.toThrow(/check constraint/);
	});

	it('accepts session 0', async () => {
		const n = await db.createNode(alice, camp.id, person(), { session_number: 0 });
		expect(n.session_number).toBe(0);
	});

	it('rejects a type from another campaign', async () => {
		const other = await db.createCampaign(alice, 'Other');
		await expect(db.createNode(alice, camp.id, other.typeId('Place'))).rejects.toThrow(/foreign key/);
	});

	it('rejects an edge to a node in another campaign', async () => {
		const other = await db.createCampaign(alice, 'Other 2');
		const here = await db.createNode(alice, camp.id, person());
		const there = await db.createNode(alice, other.id, other.typeId('Person'));
		await expect(db.createEdge(alice, camp.id, here.id, there.id)).rejects.toThrow(/foreign key/);
	});

	it('rejects an annotation over 500 characters', async () => {
		const a = await db.createNode(alice, camp.id, person());
		const b = await db.createNode(alice, camp.id, person());
		await expect(db.createEdge(alice, camp.id, a.id, b.id, { annotation: 'x'.repeat(501) })).rejects.toThrow(
			/check constraint/
		);
	});
});

describe('stamps and versions', () => {
	it('stamps the creator and ignores forged values', async () => {
		const n = await db.createNode(alice, camp.id, person(), {
			created_by: bob,
			updated_by: bob,
			version: 99,
			created_at: '2000-01-01T00:00:00Z'
		});
		expect(n.created_by).toBe(alice);
		expect(n.updated_by).toBe(alice);
		expect(n.version).toBe(1);
		expect(new Date(n.created_at).getFullYear()).toBeGreaterThan(2000);
	});

	it('bumps the version and records who changed it, keeping the creator', async () => {
		const n = await db.createNode(alice, camp.id, person());
		const updated = await db.as(bob, () =>
			db.one('update nodes set notes = $1, created_by = $2, version = 50 where id = $3 returning *', ['hi', bob, n.id])
		);
		expect(updated.version).toBe(2);
		expect(updated.created_by).toBe(alice);
		expect(updated.updated_by).toBe(bob);
	});

	it('makes a save against an old version change nothing (conflict detection)', async () => {
		const n = await db.createNode(alice, camp.id, person());
		await db.as(alice, () => db.rows('update nodes set notes = $1 where id = $2 and version = 1', ['first', n.id]));
		const stale = await db.as(bob, () =>
			db.rows('update nodes set notes = $1 where id = $2 and version = 1 returning *', ['second', n.id])
		);
		expect(stale).toEqual([]);
		const current = await db.asSystem(() => db.one('select notes, version from nodes where id = $1', [n.id]));
		expect(current).toEqual({ notes: 'first', version: 2 });
	});

	it('refuses to move a node to another campaign', async () => {
		const other = await db.createCampaign(alice, 'Elsewhere');
		const n = await db.createNode(alice, camp.id, person());
		await expect(
			db.as(alice, () => db.rows('update nodes set campaign_id = $1 where id = $2', [other.id, n.id]))
		).rejects.toThrow(/campaign_id cannot be changed/);
	});

	it('stamps and versions edges too', async () => {
		const a = await db.createNode(alice, camp.id, person());
		const b = await db.createNode(alice, camp.id, person());
		const e = await db.createEdge(alice, camp.id, a.id, b.id, { annotation: 'rules' });
		expect(e).toMatchObject({ version: 1, created_by: alice });
		const updated = await db.as(bob, () =>
			db.one('update edges set annotation = $1 where id = $2 returning *', ['ruled', e.id])
		);
		expect(updated).toMatchObject({ version: 2, created_by: alice, updated_by: bob });
	});
});

describe('history', () => {
	const history = (id: string) =>
		db.as(alice, () =>
			db.rows('select version, op, changed_by, snapshot from revisions where entity_id = $1 order by version', [id])
		);

	it('records create, update, delete and restore, with a snapshot of each version', async () => {
		const n = await db.createNode(alice, camp.id, person(), { name: 'Strahd' });
		await db.as(bob, () => db.rows('update nodes set name = $1 where id = $2', ['Count Strahd', n.id]));
		await db.as(alice, () => db.rows('update nodes set deleted_at = now() where id = $1', [n.id]));
		await db.as(bob, () => db.rows('update nodes set deleted_at = null where id = $1', [n.id]));

		const revs = await history(n.id);
		expect(revs.map((r) => [r.version, r.op, r.changed_by])).toEqual([
			[1, 'create', alice],
			[2, 'update', bob],
			[3, 'delete', alice],
			[4, 'restore', bob]
		]);
		expect(revs[0].snapshot.name).toBe('Strahd');
		expect(revs[1].snapshot.name).toBe('Count Strahd');
	});

	it('records edge history', async () => {
		const a = await db.createNode(alice, camp.id, person());
		const b = await db.createNode(alice, camp.id, person());
		const e = await db.createEdge(alice, camp.id, a.id, b.id);
		const revs = await db.as(alice, () => db.rows("select op from revisions where entity_id = $1 and entity_type = 'edge'", [e.id]));
		expect(revs).toEqual([{ op: 'create' }]);
	});

	it('cannot be written or rewritten by players', async () => {
		const n = await db.createNode(alice, camp.id, person());
		await expect(
			db.as(alice, () =>
				db.rows(
					"insert into revisions (campaign_id, entity_type, entity_id, version, op, snapshot) values ($1, 'node', $2, 9, 'update', '{}')",
					[camp.id, n.id]
				)
			)
		).rejects.toThrow(/row-level security/);
		const changed = await db.as(alice, () => db.rows("update revisions set op = 'delete' where entity_id = $1 returning id", [n.id]));
		expect(changed).toEqual([]);
		const deleted = await db.as(alice, () => db.rows('delete from revisions where entity_id = $1 returning id', [n.id]));
		expect(deleted).toEqual([]);
	});
});
