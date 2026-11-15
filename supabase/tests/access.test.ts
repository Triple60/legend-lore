import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from './harness';

// Row-level security: the browser holds a public key, so these policies are
// the only thing keeping one campaign's data away from everyone else.

let db: Db;
let owner: string;
let editor: string;
let outsider: string;
let camp: Awaited<ReturnType<Db['createCampaign']>>;
let nodeId: string;

beforeAll(async () => {
	db = await createDb();
	owner = await db.createUser({ meta: { full_name: 'Owner' } });
	editor = await db.createUser({ meta: { full_name: 'Editor' } });
	outsider = await db.createUser({ meta: { full_name: 'Outsider' } });
	camp = await db.createCampaign(owner);
	await db.join(camp.id, owner, editor);
	nodeId = (await db.createNode(owner, camp.id, camp.typeId('Person'), { name: 'Strahd' })).id;
	const village = await db.createNode(owner, camp.id, camp.typeId('Place'), { name: 'Village' });
	await db.createEdge(owner, camp.id, nodeId, village.id);
});

const count = async (userId: string, table: string) =>
	(await db.as(userId, () => db.rows(`select 1 from ${table} where campaign_id = $1`, [camp.id]))).length;

describe('campaign bootstrap', () => {
	it('makes the creator the owner and seeds the default types', async () => {
		const c = await db.createCampaign(owner, 'Fresh');
		const members = await db.as(owner, () => db.rows('select user_id, role from campaign_members where campaign_id = $1', [c.id]));
		expect(members).toEqual([{ user_id: owner, role: 'owner' }]);
		const types = await db.as(owner, () =>
			db.rows('select label from node_types where campaign_id = $1 order by sort_order', [c.id])
		);
		expect(types.map((t) => t.label)).toEqual(['Place', 'Person', 'Object', 'Lore']);
	});

	it('does not let you create a campaign in someone else’s name', async () => {
		await expect(
			db.as(outsider, () => db.rows('insert into campaigns (name, created_by) values ($1, $2)', ['Fake', owner]))
		).rejects.toThrow(/row-level security/);
	});

	it.each(['', '   ', 'x'.repeat(201)])('rejects the campaign name %j', async (name) => {
		await expect(db.createCampaign(owner, name)).rejects.toThrow(/check constraint/);
	});
});

describe('outsiders', () => {
	it.each(['nodes', 'edges', 'node_types', 'campaign_members', 'campaign_invites', 'revisions'])(
		'cannot read %s',
		async (table) => {
			// Members can see these rows, so an empty result really is RLS.
			expect(await count(owner, table)).toBeGreaterThan(0);
			expect(await count(outsider, table)).toBe(0);
		}
	);

	it('cannot see the campaign', async () => {
		const rows = await db.as(outsider, () => db.rows('select * from campaigns where id = $1', [camp.id]));
		expect(rows).toEqual([]);
	});

	it('cannot add nodes or types', async () => {
		await expect(db.createNode(outsider, camp.id, camp.typeId('Person'))).rejects.toThrow(/row-level security/);
		await expect(
			db.as(outsider, () => db.rows('insert into node_types (campaign_id, label) values ($1, $2)', [camp.id, 'Hack']))
		).rejects.toThrow(/row-level security/);
	});

	it('cannot change nodes', async () => {
		const changed = await db.as(outsider, () => db.rows("update nodes set name = 'pwned' where id = $1 returning id", [nodeId]));
		expect(changed).toEqual([]);
	});

	it('cannot make themselves a member', async () => {
		await expect(
			db.as(outsider, () =>
				db.rows("insert into campaign_members (campaign_id, user_id, role) values ($1, $2, 'owner')", [camp.id, outsider])
			)
		).rejects.toThrow(/row-level security/);
	});

	it('cannot create invites', async () => {
		await expect(db.invite(camp.id, outsider)).rejects.toThrow(/row-level security/);
	});
});

describe('signed-out visitors', () => {
	it.each(['campaigns', 'nodes', 'profiles'])('cannot read %s', async (table) => {
		expect(await db.asAnon(() => db.rows(`select * from ${table}`))).toEqual([]);
	});

	it('cannot accept invites', async () => {
		const token = await db.invite(camp.id, owner);
		await expect(db.asAnon(() => db.rows('select public.accept_invite($1)', [token]))).rejects.toThrow(/permission denied/);
	});
});

describe('members', () => {
	it('can read and edit everything in the campaign', async () => {
		expect(await count(editor, 'nodes')).toBeGreaterThan(0);
		const updated = await db.as(editor, () => db.rows("update nodes set notes = 'seen' where id = $1 returning id", [nodeId]));
		expect(updated).toHaveLength(1);
	});

	it('can add node types, but not duplicate labels', async () => {
		await db.as(editor, () =>
			db.rows('insert into node_types (campaign_id, label, color) values ($1, $2, $3)', [camp.id, 'Faction', '#123456'])
		);
		await expect(
			db.as(editor, () => db.rows('insert into node_types (campaign_id, label) values ($1, $2)', [camp.id, 'faction']))
		).rejects.toThrow(/duplicate key/);
	});

	it('rejects a malformed type colour', async () => {
		await expect(
			db.as(editor, () =>
				db.rows('insert into node_types (campaign_id, label, color) values ($1, $2, $3)', [camp.id, 'Bad', 'red'])
			)
		).rejects.toThrow(/check constraint/);
	});

	it('cannot delete a type that nodes still use', async () => {
		await expect(
			db.as(editor, () => db.rows('delete from node_types where id = $1', [camp.typeId('Person')]))
		).rejects.toThrow(/foreign key/);
	});

	it('cannot hard-delete nodes or edges, only soft-delete them', async () => {
		const deleted = await db.as(owner, () => db.rows('delete from nodes where id = $1 returning id', [nodeId]));
		expect(deleted).toEqual([]);
		const still = await db.asSystem(() => db.rows('select id from nodes where id = $1', [nodeId]));
		expect(still).toHaveLength(1);
	});

	it('only the owner can rename the campaign', async () => {
		const byEditor = await db.as(editor, () => db.rows("update campaigns set name = 'Mine' where id = $1 returning id", [camp.id]));
		expect(byEditor).toEqual([]);
		const byOwner = await db.as(owner, () => db.rows("update campaigns set name = 'Renamed' where id = $1 returning id", [camp.id]));
		expect(byOwner).toHaveLength(1);
	});

	it('only the owner can delete the campaign', async () => {
		const c = await db.createCampaign(owner, 'Doomed');
		await db.join(c.id, owner, editor);
		expect(await db.as(editor, () => db.rows('delete from campaigns where id = $1 returning id', [c.id]))).toEqual([]);
		expect(await db.as(owner, () => db.rows('delete from campaigns where id = $1 returning id', [c.id]))).toHaveLength(1);
	});

	it('an editor can leave but cannot remove others; the owner can remove anyone', async () => {
		const c = await db.createCampaign(owner, 'Party');
		const p1 = await db.createUser();
		const p2 = await db.createUser();
		await db.join(c.id, owner, p1);
		await db.join(c.id, owner, p2);

		const kick = (by: string, who: string) =>
			db.as(by, () => db.rows('delete from campaign_members where campaign_id = $1 and user_id = $2 returning user_id', [c.id, who]));

		expect(await kick(p1, owner)).toEqual([]);
		expect(await kick(p1, p2)).toEqual([]);
		expect(await kick(p1, p1)).toHaveLength(1);
		expect(await kick(owner, p2)).toHaveLength(1);
	});

	it('cannot promote themselves to owner', async () => {
		const changed = await db.as(editor, () =>
			db.rows("update campaign_members set role = 'owner' where user_id = $1 returning role", [editor])
		);
		expect(changed).toEqual([]);
	});
});

describe('invites', () => {
	it('lets a signed-in user join as an editor', async () => {
		const c = await db.createCampaign(owner, 'Open table');
		const newcomer = await db.createUser();
		const token = await db.invite(c.id, owner);
		const [{ accept_invite }] = await db.as(newcomer, () => db.rows('select public.accept_invite($1)', [token]));
		expect(accept_invite).toBe(c.id);
		const role = await db.as(newcomer, () =>
			db.one('select role from campaign_members where campaign_id = $1 and user_id = $2', [c.id, newcomer])
		);
		expect(role).toEqual({ role: 'editor' });
	});

	it('is harmless to accept twice, and never demotes the owner', async () => {
		const token = await db.invite(camp.id, editor);
		await db.as(owner, () => db.rows('select public.accept_invite($1)', [token]));
		await db.as(editor, () => db.rows('select public.accept_invite($1)', [token]));
		const roles = await db.as(owner, () =>
			db.rows('select user_id, role from campaign_members where campaign_id = $1 order by role desc', [camp.id])
		);
		expect(roles).toEqual([
			{ user_id: owner, role: 'owner' },
			{ user_id: editor, role: 'editor' }
		]);
	});

	it('rejects unknown and expired tokens', async () => {
		const token = await db.invite(camp.id, owner);
		await db.asSystem(() => db.rows("update campaign_invites set expires_at = now() - interval '1 second' where token = $1", [token]));
		const user = await db.createUser();
		await expect(db.as(user, () => db.rows('select public.accept_invite($1)', [token]))).rejects.toThrow(/invalid or has expired/);
		await expect(db.as(user, () => db.rows('select public.accept_invite($1)', ['nope']))).rejects.toThrow(/invalid or has expired/);
	});

	it('expire after 7 days by default', async () => {
		const token = await db.invite(camp.id, owner);
		const { days } = await db.as(owner, () =>
			db.one('select round(extract(epoch from expires_at - created_at) / 86400) as days from campaign_invites where token = $1', [token])
		);
		expect(Number(days)).toBe(7);
	});
});

describe('profiles', () => {
	it.each([
		['Discord global name', { email: 'a@example.com', meta: { custom_claims: { global_name: 'Glob' }, full_name: 'Full' } }, 'Glob'],
		['full name', { email: 'a@example.com', meta: { full_name: 'Full', name: 'Short' } }, 'Full'],
		['name', { email: 'a@example.com', meta: { name: 'Short' } }, 'Short'],
		['email prefix', { email: 'bilbo@example.com', meta: {} }, 'bilbo'],
		['fallback', { email: null, meta: {} }, 'Adventurer']
	])('are created on sign-up from the %s', async (_label, opts, expected) => {
		const id = await db.createUser(opts);
		const { display_name } = await db.as(id, () => db.one('select display_name from profiles where id = $1', [id]));
		expect(display_name).toBe(expected);
	});

	it('are visible to yourself and campaign-mates only', async () => {
		const visible = await db.as(editor, () => db.rows('select id from profiles where id = any($1)', [[owner, editor, outsider]]));
		expect(visible.map((p) => p.id).sort()).toEqual([owner, editor].sort());
	});

	it('can only be renamed by their owner', async () => {
		const other = await db.as(editor, () => db.rows("update profiles set display_name = 'x' where id = $1 returning id", [owner]));
		expect(other).toEqual([]);
		const mine = await db.as(editor, () => db.rows("update profiles set display_name = 'Ed' where id = $1 returning id", [editor]));
		expect(mine).toHaveLength(1);
	});
});
