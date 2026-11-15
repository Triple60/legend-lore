import type { LoreEdge, LoreNode } from './types';

export interface GraphFilter {
	/** Type ids to leave out. */
	hiddenTypes: string[];
	/** Show only what was known as of this session; null shows everything. */
	asOfSession: number | null;
}

const knownBy = (session: number | null, cap: number | null) =>
	cap === null || session === null || session <= cap;

/**
 * The nodes and edges to draw. Anything without a session number is always
 * shown, and an edge is shown only when both of its ends are.
 */
export function filterGraph(nodes: LoreNode[], edges: LoreEdge[], { hiddenTypes, asOfSession }: GraphFilter) {
	const visibleNodes = nodes.filter(
		(n) => !hiddenTypes.includes(n.type_id) && knownBy(n.session_number, asOfSession)
	);
	const ids = new Set(visibleNodes.map((n) => n.id));
	const visibleEdges = edges.filter(
		(e) => ids.has(e.from_id) && ids.has(e.to_id) && knownBy(e.session_number, asOfSession)
	);
	return { visibleNodes, visibleEdges };
}
