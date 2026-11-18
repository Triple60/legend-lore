/**
 * An in-memory stand-in for the Supabase client, used by demo builds
 * (PUBLIC_DEMO=true, e.g. the per-branch preview sites).
 *
 * It covers only what the app calls: auth (always signed in as a demo user),
 * `from(table)` queries, `rpc('accept_invite')` and realtime channels with
 * presence. It also does what the database's triggers do: stamps ids,
 * authors, timestamps and versions, tidies tags and aliases, and records
 * revisions. Nothing is stored anywhere, so a page refresh resets everything.
 */
import { DEMO_USER, sampleData, type DemoTables } from './sample.ts';

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };

const TRACKED = new Set(['nodes', 'edges']);
const now = () => new Date().toISOString();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)); // also unwraps Svelte proxies

/** Trim, drop blanks and de-duplicate, like the database's normalise_list(). */
function tidy(list: unknown): string[] {
	if (!Array.isArray(list)) return [];
	return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
}

export function createDemoClient(tables: DemoTables = sampleData()) {
	let revisionId = tables.revisions.length;

	function record(table: string, row: Row, op: string) {
		tables.revisions.push({
			id: ++revisionId,
			campaign_id: row.campaign_id,
			entity_type: table === 'nodes' ? 'node' : 'edge',
			entity_id: row.id,
			version: row.version,
			op,
			snapshot: clone(row),
			changed_by: DEMO_USER.id,
			changed_at: now()
		});
	}

	function insertRow(table: string, input: Row): Row {
		const row: Row = { id: crypto.randomUUID(), ...clone(input) };
		if (table === 'campaigns') {
			Object.assign(row, { created_by: DEMO_USER.id, created_at: now() });
			['Place', 'Person', 'Object', 'Lore'].forEach((label, i) =>
				tables.node_types.push({
					id: crypto.randomUUID(),
					campaign_id: row.id,
					label,
					color: ['#4e79a7', '#e15759', '#f28e2b', '#76b7b2'][i],
					icon: null,
					sort_order: i
				})
			);
		} else if (table === 'campaign_invites') {
			row.token = crypto.randomUUID().replaceAll('-', '');
		} else if (TRACKED.has(table)) {
			Object.assign(row, {
				session_number: row.session_number ?? null,
				version: 1,
				created_by: DEMO_USER.id,
				created_at: now(),
				updated_by: DEMO_USER.id,
				updated_at: now(),
				deleted_at: null
			});
			if (table === 'nodes') {
				Object.assign(row, { aliases: tidy(row.aliases), tags: tidy(row.tags), notes: row.notes ?? '' });
			} else row.annotation = row.annotation ?? '';
			record(table, row, 'create');
		}
		(tables[table as keyof DemoTables] as Row[]).push(row);
		return row;
	}

	function updateRow(table: string, row: Row, patch: Row) {
		const wasDeleted = Boolean(row.deleted_at);
		Object.assign(row, clone(patch));
		if (!TRACKED.has(table)) return;
		if (table === 'nodes') Object.assign(row, { aliases: tidy(row.aliases), tags: tidy(row.tags) });
		Object.assign(row, { version: (row.version as number) + 1, updated_by: DEMO_USER.id, updated_at: now() });
		const op = !wasDeleted && row.deleted_at ? 'delete' : wasDeleted && !row.deleted_at ? 'restore' : 'update';
		record(table, row, op);
	}

	function from(table: string) {
		if (!(table in tables)) throw new Error(`Demo backend has no table "${table}"`);
		let action: { kind: 'select' } | { kind: 'insert'; rows: Row[] } | { kind: 'update'; patch: Row } = {
			kind: 'select'
		};
		let columns = '*';
		const filters: [string, unknown][] = [];
		let ordering: { column: string; ascending: boolean } | null = null;
		let limit = Infinity;
		let shape: 'many' | 'single' | 'maybeSingle' = 'many';

		function run(): Result {
			const all = tables[table as keyof DemoTables] as Row[];
			let rows: Row[];
			if (action.kind === 'insert') {
				rows = action.rows.map((r) => insertRow(table, r));
			} else {
				rows = all.filter((r) => filters.every(([c, v]) => r[c] === v));
				if (action.kind === 'update') {
					const patch = action.patch;
					rows.forEach((r) => updateRow(table, r, patch));
				}
			}
			if (ordering) {
				const { column, ascending } = ordering;
				rows = [...rows].sort((a, b) => {
					const x = a[column] as string | number;
					const y = b[column] as string | number;
					return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
				});
			}
			rows = rows.slice(0, limit).map((r) => project(r, columns));
			if (shape === 'many') return { data: rows, error: null };
			if (rows.length > 1 || (shape === 'single' && rows.length === 0)) {
				return { data: null, error: { message: `Expected one row, got ${rows.length}` } };
			}
			return { data: rows[0] ?? null, error: null };
		}

		const builder = {
			select(cols = '*') {
				columns = cols;
				return builder;
			},
			insert(rows: Row | Row[]) {
				action = { kind: 'insert', rows: Array.isArray(rows) ? rows : [rows] };
				return builder;
			},
			update(patch: Row) {
				action = { kind: 'update', patch };
				return builder;
			},
			eq(column: string, value: unknown) {
				filters.push([column, value]);
				return builder;
			},
			order(column: string, opts: { ascending?: boolean } = {}) {
				ordering = { column, ascending: opts.ascending ?? true };
				return builder;
			},
			limit(n: number) {
				limit = n;
				return builder;
			},
			single() {
				shape = 'single';
				return builder;
			},
			maybeSingle() {
				shape = 'maybeSingle';
				return builder;
			},
			then<T>(ok: (r: Result) => T, bad?: (e: unknown) => T) {
				// Async like the real client, so UI states like "Saving…" still show.
				return Promise.resolve().then(run).then(ok, bad);
			}
		};
		return builder;
	}

	const session = {
		access_token: 'demo',
		token_type: 'bearer',
		user: { id: DEMO_USER.id, email: DEMO_USER.email, user_metadata: { full_name: DEMO_USER.name } }
	};
	const unavailable = async () => ({ data: null, error: { message: 'Not available in the demo.' } });

	const auth = {
		getSession: async () => ({ data: { session }, error: null }),
		onAuthStateChange(cb: (event: string, s: typeof session) => void) {
			queueMicrotask(() => cb('INITIAL_SESSION', session));
			return { data: { subscription: { unsubscribe() {} } } };
		},
		// "Sign out" starts the demo over.
		signOut: async () => {
			location.reload();
			return { error: null };
		},
		signInWithOAuth: unavailable,
		signInWithOtp: unavailable,
		verifyOtp: unavailable
	};

	async function rpc(name: string, args: Row): Promise<Result> {
		if (name !== 'accept_invite') return { data: null, error: { message: `Demo backend has no function "${name}"` } };
		const invite = tables.campaign_invites.find((i) => i.token === args.invite_token);
		return invite
			? { data: invite.campaign_id, error: null }
			: { data: null, error: { message: 'This invite link is invalid or has expired.' } };
	}

	// --- Realtime: a channel only ever hears this tab's own presence. ---
	type Handler = { type: string; event?: string; cb: (...args: unknown[]) => void };
	const channels: ReturnType<typeof makeChannel>[] = [];

	function makeChannel(name: string, opts?: { config?: { presence?: { key?: string } } }) {
		const key = opts?.config?.presence?.key || 'me';
		const handlers: Handler[] = [];
		const presence: Record<string, Row[]> = {};
		const channel = {
			topic: `realtime:${name}`,
			on(type: string, filter: { event?: string }, cb: (...args: unknown[]) => void) {
				handlers.push({ type, event: filter?.event, cb });
				return channel;
			},
			subscribe(cb?: (status: string) => void) {
				queueMicrotask(() => cb?.('SUBSCRIBED'));
				return channel;
			},
			async track(meta: Row) {
				presence[key] = [clone(meta)];
				for (const h of handlers) if (h.type === 'presence' && h.event === 'sync') h.cb();
				return 'ok';
			},
			presenceState: () => clone(presence),
			unsubscribe: async () => 'ok'
		};
		return channel;
	}

	return {
		auth,
		from,
		rpc,
		channel(name: string, opts?: Parameters<typeof makeChannel>[1]) {
			const c = makeChannel(name, opts);
			channels.push(c);
			return c;
		},
		getChannels: () => [...channels],
		async removeChannel(c: ReturnType<typeof makeChannel>) {
			const i = channels.indexOf(c);
			if (i >= 0) channels.splice(i, 1);
			return 'ok';
		}
	};
}

/** Keep only the listed columns, e.g. select('id, display_name'). */
function project(row: Row, columns: string): Row {
	const copy = clone(row);
	if (columns.trim() === '*') return copy;
	const keep = columns.split(',').map((c) => c.trim());
	return Object.fromEntries(keep.map((c) => [c, copy[c]]));
}
