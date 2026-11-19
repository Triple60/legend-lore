import { vi } from 'vitest';

/** One recorded query: the table plus each builder call, e.g. ['eq', 'id', 'x']. */
export interface RecordedQuery {
	table: string;
	ops: [string, ...unknown[]][];
}

type Result = { data: unknown; error: { message: string } | null };

/**
 * A stand-in for the Supabase client: every `from(table)...` chain is recorded
 * and resolves to whatever `respond` returns for it (default: no rows).
 */
export function createFakeSupabase() {
	const queries: RecordedQuery[] = [];
	let respond: (q: RecordedQuery) => Result = () => ({ data: [], error: null });

	const methods = ['select', 'insert', 'update', 'eq', 'order', 'limit', 'single', 'maybeSingle'];
	function from(table: string) {
		const q: RecordedQuery = { table, ops: [] };
		queries.push(q);
		const builder: Record<string, unknown> = {
			then: (ok: (r: Result) => unknown, bad?: (e: unknown) => unknown) =>
				Promise.resolve()
					.then(() => respond(q))
					.then(ok, bad)
		};
		for (const m of methods) {
			builder[m] = (...args: unknown[]) => {
				q.ops.push([m, ...args]);
				return builder;
			};
		}
		return builder;
	}

	const channel = {
		on: vi.fn().mockReturnThis(),
		subscribe: vi.fn().mockReturnThis(),
		track: vi.fn(async () => 'ok'),
		presenceState: vi.fn(() => ({}))
	};

	const client = {
		from: vi.fn(from),
		channel: vi.fn(() => channel),
		getChannels: vi.fn(() => []),
		removeChannel: vi.fn()
	};

	return {
		client,
		channel,
		queries,
		/** Set how queries are answered. */
		respondWith(fn: (q: RecordedQuery) => Result) {
			respond = fn;
		},
		reset() {
			queries.length = 0;
			respond = () => ({ data: [], error: null });
		}
	};
}

/** The value passed to `op` in a recorded query, e.g. arg(q, 'insert'). */
export const arg = (q: RecordedQuery, op: string) => q.ops.find(([name]) => name === op)?.[1];
