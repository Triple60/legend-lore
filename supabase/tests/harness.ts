import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrations = join(import.meta.dirname, '..', 'migrations');

/**
 * The bits of Supabase the migrations rely on: the anon/authenticated roles,
 * auth.users, and auth.uid() reading the signed-in user from a setting (the
 * real one reads the request's JWT the same way).
 */
const SUPABASE_STUBS = `
	create role anon nologin;
	create role authenticated nologin;
	create schema auth;
	create table auth.users (
		id uuid primary key,
		email text,
		raw_user_meta_data jsonb not null default '{}'
	);
	create function auth.uid() returns uuid language sql stable as $$
		select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
	$$;
	grant usage on schema auth, public to anon, authenticated;
	grant execute on function auth.uid() to anon, authenticated;
`;

// Supabase's default table privileges; RLS then does the real limiting.
const SUPABASE_GRANTS = `
	grant select, insert, update, delete on all tables in schema public to anon, authenticated;
	grant usage, select on all sequences in schema public to anon, authenticated;
`;

export type Db = Awaited<ReturnType<typeof createDb>>;

export async function createDb() {
	const pg = new PGlite();
	await pg.exec(SUPABASE_STUBS);
	for (const file of readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) {
		await pg.exec(readFileSync(join(migrations, file), 'utf8'));
	}
	await pg.exec(SUPABASE_GRANTS);

	let users = 0;

	const db = {
		pg,

		/** Run `fn` as a signed-in user, through RLS. */
		as<T>(userId: string, fn: () => Promise<T>) {
			return withRole('authenticated', userId, fn);
		},

		/** Run `fn` as a signed-out visitor. */
		asAnon<T>(fn: () => Promise<T>) {
			return withRole('anon', '', fn);
		},

		/** Run `fn` as the database owner, bypassing RLS (for setup and checks). */
		asSystem<T>(fn: () => Promise<T>) {
			return withRole(null, '', fn);
		},

		/** Rows from a query run in the current role. */
		async rows<T = Record<string, any>>(sql: string, params: unknown[] = []) {
			return (await pg.query<T>(sql, params)).rows;
		},

		async one<T = Record<string, any>>(sql: string, params: unknown[] = []) {
			const [row] = await db.rows<T>(sql, params);
			return row;
		},

		/** Create an auth user (as the system, like a real sign-up). */
		async createUser(opts: { email?: string | null; meta?: object } = {}) {
			const id = `00000000-0000-4000-8000-${String(++users).padStart(12, '0')}`;
			const email = opts.email === undefined ? `user${users}@example.com` : opts.email;
			await db.asSystem(() =>
				pg.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [
					id,
					email,
					JSON.stringify(opts.meta ?? {})
				])
			);
			return id;
		},

		/** A campaign created by `userId`, with its default types. */
		async createCampaign(userId: string, name = 'Curse of Strahd') {
			return db.as(userId, async () => {
				const c = await db.one<{ id: string }>('insert into campaigns (name) values ($1) returning id', [name]);
				const types = await db.rows<{ id: string; label: string }>(
					'select id, label from node_types where campaign_id = $1 order by sort_order',
					[c.id]
				);
				return { id: c.id, typeId: (label: string) => types.find((t) => t.label === label)!.id };
			});
		},

		/** Create an invite as `inviterId` and return its token. */
		async invite(campaignId: string, inviterId: string) {
			const row = await db.as(inviterId, () =>
				db.one<{ token: string }>('insert into campaign_invites (campaign_id) values ($1) returning token', [
					campaignId
				])
			);
			return row.token;
		},

		/** Add `userId` to a campaign via a fresh invite from `inviterId`. */
		async join(campaignId: string, inviterId: string, userId: string) {
			const token = await db.invite(campaignId, inviterId);
			await db.as(userId, () => db.rows('select public.accept_invite($1)', [token]));
		},

		/** Insert a node as `userId` and return the stored row. */
		async createNode(userId: string, campaignId: string, typeId: string, fields: Record<string, unknown> = {}) {
			return db.as(userId, () => insert('nodes', { campaign_id: campaignId, type_id: typeId, name: 'Node', ...fields }));
		},

		/** Insert an edge as `userId` and return the stored row. */
		async createEdge(userId: string, campaignId: string, fromId: string, toId: string, fields: Record<string, unknown> = {}) {
			return db.as(userId, () => insert('edges', { campaign_id: campaignId, from_id: fromId, to_id: toId, ...fields }));
		}
	};

	async function withRole<T>(role: string | null, userId: string, fn: () => Promise<T>): Promise<T> {
		await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
		await pg.exec(role ? `set role ${role}` : 'reset role');
		try {
			return await fn();
		} finally {
			await pg.exec('reset role');
			await pg.query(`select set_config('request.jwt.claim.sub', '', false)`);
		}
	}

	function insert(table: string, cols: Record<string, unknown>) {
		const keys = Object.keys(cols);
		const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
		return db.one(`insert into ${table} (${keys.join(', ')}) values (${placeholders}) returning *`, Object.values(cols));
	}

	return db;
}
