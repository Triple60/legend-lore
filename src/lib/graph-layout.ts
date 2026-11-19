/**
 * "Reorganize": find tidier positions for the whole map by minimising a loss
 * function, then let the map glide there (see GraphPhysics.animateTo).
 *
 * The loss adds up, with weights:
 * - crossings: each pair of connections whose lines cross;
 * - connection length: how far each connection is from its natural length
 *   (just long enough for its annotation, see linkLength);
 * - spread: how far every node is from the middle, so the map stays compact
 *   and unconnected nodes don't drift off;
 * - overlap: nodes (and their name labels) sitting on top of each other,
 *   which keeps "compact" from collapsing everything into a heap;
 * - lines through nodes: a connection passing over a node (or its name)
 *   that it doesn't join;
 * - annotations: each connection's middle, where its annotation is drawn, is
 *   treated as a body of its own, which must keep clear of nodes and of
 *   other connections' annotations.
 *
 * Crossings are a count, so the loss has no useful gradient. It is minimised
 * by simulated annealing instead: move one node at a time (or swap two),
 * keep the move if it lowers the loss, and early on sometimes keep one that
 * raises it, to climb out of local minima. Only the terms that involve the
 * moved nodes are recomputed, so each step is cheap.
 */

export interface LayoutNode {
	id: string;
	x: number;
	y: number;
	/** Width of the node with its name label, in pixels. */
	width: number;
}

export interface LayoutEdge {
	source: string;
	target: string;
	/** Natural length of this connection, in pixels. */
	length: number;
	/** Size of the annotation drawn at its middle, in pixels (none if left out). */
	labelWidth?: number;
	labelHeight?: number;
}

export interface LayoutWeights {
	crossing: number;
	length: number;
	spread: number;
	overlap: number;
	throughNode: number;
	label: number;
}

export const DEFAULT_WEIGHTS: LayoutWeights = {
	crossing: 2,
	length: 0.6,
	spread: 0.02,
	overlap: 30,
	throughNode: 2,
	label: 12
};

export interface LayoutOptions {
	weights?: Partial<LayoutWeights>;
	/** Annealing steps per run; defaults to a number that grows with the graph. */
	iterations?: number;
	/** Independent runs to try, keeping the best; defaults to 6 (1 on a big map). */
	restarts?: number;
	/** Seed for the random moves, so the same map reorganizes the same way. */
	seed?: number;
	/**
	 * Most milliseconds to spend. On a big map the search cools faster to fit
	 * in this, trading a little tidiness for not keeping the person waiting.
	 */
	timeBudget?: number;
}

/** Distances are measured in units of this many pixels. */
const UNIT = 100;
/** Height a node and its label take up, for overlap purposes. */
const NODE_HEIGHT = 46;
/** Breathing room kept between neighbouring nodes. */
const GAP = 24;
/** Room kept between a line and the edge of a node (or its name). */
const LINE_PAD = 8;
/** How far below a node's centre the middle of the node-plus-name block is. */
const NAME_DROP = 9;

interface Model {
	n: number;
	x: Float64Array;
	y: Float64Array;
	w: Float64Array;
	/** Edge endpoints and lengths, by edge index. */
	ea: Int32Array;
	eb: Int32Array;
	elen: Float64Array;
	/** Half the width and height of each edge's annotation (0 for none). */
	elw: Float64Array;
	elh: Float64Array;
	/** Edge indices touching each node. */
	incident: number[][];
	cx: number;
	cy: number;
	wt: LayoutWeights;
	/** Scratch marks for "this edge touches a moved node", by edge index. */
	mark: Int32Array;
	stamp: number;
}

function build(nodes: LayoutNode[], edges: LayoutEdge[], weights?: Partial<LayoutWeights>): Model {
	const n = nodes.length;
	const index = new Map(nodes.map((nd, i) => [nd.id, i]));
	const x = Float64Array.from(nodes, (nd) => nd.x);
	const y = Float64Array.from(nodes, (nd) => nd.y);
	const w = Float64Array.from(nodes, (nd) => Math.max(26, nd.width));
	const ea: number[] = [];
	const eb: number[] = [];
	const elen: number[] = [];
	const elw: number[] = [];
	const elh: number[] = [];
	const seen = new Map<string, number>();
	for (const e of edges) {
		const a = index.get(e.source);
		const b = index.get(e.target);
		if (a === undefined || b === undefined || a === b) continue;
		// Two connections between the same pair are drawn side by side; one is enough here.
		// Keep the bigger annotation, which is the one that needs the room.
		const key = a < b ? `${a}:${b}` : `${b}:${a}`;
		const lw = Math.max(0, e.labelWidth ?? 0) / 2;
		const lh = lw > 0 ? Math.max(0, e.labelHeight ?? 0) / 2 : 0;
		const dup = seen.get(key);
		if (dup !== undefined) {
			elen[dup] = Math.max(elen[dup], e.length);
			elw[dup] = Math.max(elw[dup], lw);
			elh[dup] = Math.max(elh[dup], lh);
			continue;
		}
		seen.set(key, ea.length);
		ea.push(a);
		eb.push(b);
		elen.push(e.length);
		elw.push(lw);
		elh.push(lh);
	}
	const incident: number[][] = Array.from({ length: n }, () => []);
	ea.forEach((a, i) => {
		incident[a].push(i);
		incident[eb[i]].push(i);
	});
	let cx = 0;
	let cy = 0;
	for (let i = 0; i < n; i++) {
		cx += x[i] / n;
		cy += y[i] / n;
	}
	return {
		n,
		x,
		y,
		w,
		ea: Int32Array.from(ea),
		eb: Int32Array.from(eb),
		elen: Float64Array.from(elen),
		elw: Float64Array.from(elw),
		elh: Float64Array.from(elh),
		incident,
		cx: n ? cx : 0,
		cy: n ? cy : 0,
		wt: { ...DEFAULT_WEIGHTS, ...weights },
		mark: new Int32Array(ea.length),
		stamp: 0
	};
}

// --- The loss terms ---------------------------------------------------------

function overlapTerm(m: Model, i: number, j: number): number {
	// Nodes are wide (their name sits under them), so measure overlap in an
	// ellipse stretched to the two labels' widths.
	const ax = (m.w[i] + m.w[j]) / 2 + GAP;
	const ay = NODE_HEIGHT + GAP;
	const dx = (m.x[i] - m.x[j]) / ax;
	const dy = (m.y[i] - m.y[j]) / ay;
	const d2 = dx * dx + dy * dy;
	if (d2 >= 1) return 0;
	const t = 1 - Math.sqrt(d2);
	return m.wt.overlap * t * t;
}

function spreadTerm(m: Model, i: number): number {
	const dx = (m.x[i] - m.cx) / UNIT;
	const dy = (m.y[i] - m.cy) / UNIT;
	return m.wt.spread * (dx * dx + dy * dy);
}

function lengthTerm(m: Model, e: number): number {
	const d = Math.hypot(m.x[m.ea[e]] - m.x[m.eb[e]], m.y[m.ea[e]] - m.y[m.eb[e]]);
	const t = (d - m.elen[e]) / UNIT;
	// Too short hides the annotation; weigh that a little more than too long.
	return m.wt.length * t * t * (t < 0 ? 2 : 1);
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
	return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Do the straight segments p1–p2 and p3–p4 properly cross? */
export function segmentsCross(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	x3: number,
	y3: number,
	x4: number,
	y4: number
): boolean {
	const d1 = orient(x3, y3, x4, y4, x1, y1);
	const d2 = orient(x3, y3, x4, y4, x2, y2);
	const d3 = orient(x1, y1, x2, y2, x3, y3);
	const d4 = orient(x1, y1, x2, y2, x4, y4);
	return d1 * d2 < 0 && d3 * d4 < 0;
}

function crossTerm(m: Model, e: number, f: number): number {
	const a = m.ea[e];
	const b = m.eb[e];
	const c = m.ea[f];
	const d = m.eb[f];
	// Connections that share a node meet there; that's not a crossing.
	if (a === c || a === d || b === c || b === d) return 0;
	// Cheap reject: bounding boxes that don't overlap can't cross.
	const x = m.x;
	const y = m.y;
	if (Math.max(x[a], x[b]) < Math.min(x[c], x[d]) || Math.max(x[c], x[d]) < Math.min(x[a], x[b])) return 0;
	if (Math.max(y[a], y[b]) < Math.min(y[c], y[d]) || Math.max(y[c], y[d]) < Math.min(y[a], y[b])) return 0;
	return segmentsCross(m.x[a], m.y[a], m.x[b], m.y[b], m.x[c], m.y[c], m.x[d], m.y[d]) ? m.wt.crossing : 0;
}

/**
 * Node `k` sitting on connection `e`, which it isn't part of: on the line
 * itself, or on the annotation drawn at its middle. Measured in the line's
 * own frame (u along it, v across), since annotations turn with their line.
 */
function throughTerm(m: Model, e: number, k: number): number {
	const a = m.ea[e];
	const b = m.eb[e];
	if (k === a || k === b) return 0;
	const x = m.x;
	const y = m.y;
	// The node with its name under it, as a box around this middle.
	const kx = x[k];
	const ky = y[k] + NAME_DROP;
	const hw = m.w[k] / 2;
	const hh = NODE_HEIGHT / 2;
	const lw = m.elw[e];
	const lh = m.elh[e];
	const reach = Math.max(hw, hh) + lh + LINE_PAD;
	if (kx < Math.min(x[a], x[b]) - reach || kx > Math.max(x[a], x[b]) + reach) return 0;
	if (ky < Math.min(y[a], y[b]) - reach || ky > Math.max(y[a], y[b]) + reach) return 0;
	const vx = x[b] - x[a];
	const vy = y[b] - y[a];
	const len = Math.hypot(vx, vy);
	if (len === 0) return 0;
	const ux = vx / len;
	const uy = vy / len;
	const u = (kx - x[a]) * ux + (ky - y[a]) * uy;
	const v = (kx - x[a]) * -uy + (ky - y[a]) * ux;
	// How far the node's box reaches along the line, and across it.
	const ru = Math.abs(ux) * hw + Math.abs(uy) * hh;
	const rv = Math.abs(uy) * hw + Math.abs(ux) * hh;
	let sum = 0;
	if (u > 0 && u < len) {
		const clear = rv + LINE_PAD;
		const depth = clear - Math.abs(v);
		if (depth > 0) sum += m.wt.throughNode * (depth / clear);
	}
	if (lw > 0) {
		const du = (u - len / 2) / (lw + ru + GAP / 2);
		const dv = v / (lh + rv + GAP / 2);
		const d2 = du * du + dv * dv;
		if (d2 < 1) {
			const t = 1 - Math.sqrt(d2);
			sum += m.wt.label * t * t;
		}
	}
	return sum;
}

/** How far edge `e`'s annotation reaches across (hx) and down (hy) the map. */
function labelReach(m: Model, e: number): [number, number] {
	const vx = m.x[m.eb[e]] - m.x[m.ea[e]];
	const vy = m.y[m.eb[e]] - m.y[m.ea[e]];
	const len = Math.hypot(vx, vy) || 1;
	const cx = Math.abs(vx / len);
	const cy = Math.abs(vy / len);
	return [cx * m.elw[e] + cy * m.elh[e], cy * m.elw[e] + cx * m.elh[e]];
}

/** Two connections' annotations drawn on top of each other. */
function labelPairTerm(m: Model, e: number, f: number): number {
	if (m.elw[e] === 0 || m.elw[f] === 0) return 0;
	const ex = (m.x[m.ea[e]] + m.x[m.eb[e]]) / 2;
	const ey = (m.y[m.ea[e]] + m.y[m.eb[e]]) / 2;
	const fx = (m.x[m.ea[f]] + m.x[m.eb[f]]) / 2;
	const fy = (m.y[m.ea[f]] + m.y[m.eb[f]]) / 2;
	const reach = m.elw[e] + m.elw[f] + GAP;
	if (Math.abs(ex - fx) > reach || Math.abs(ey - fy) > reach) return 0;
	const [ehx, ehy] = labelReach(m, e);
	const [fhx, fhy] = labelReach(m, f);
	const dx = (ex - fx) / (ehx + fhx + GAP / 2);
	const dy = (ey - fy) / (ehy + fhy + GAP / 2);
	const d2 = dx * dx + dy * dy;
	if (d2 >= 1) return 0;
	const t = 1 - Math.sqrt(d2);
	return m.wt.label * t * t;
}

/** Every term that involves at least one node in `moved`, each counted once. */
function localLoss(m: Model, i: number, j: number): number {
	// `j` is the second moved node, or -1 when only `i` moved.
	const stamp = ++m.stamp;
	const edges: number[] = [];
	for (const e of m.incident[i]) if (m.mark[e] !== stamp) (m.mark[e] = stamp), edges.push(e);
	if (j >= 0) for (const e of m.incident[j]) if (m.mark[e] !== stamp) (m.mark[e] = stamp), edges.push(e);
	const E = m.ea.length;
	let sum = 0;

	for (const k of j >= 0 ? [i, j] : [i]) {
		sum += spreadTerm(m, k);
		for (let o = 0; o < m.n; o++) {
			if (o === k || (o === j && k === i)) continue; // the i–j pair is counted once, from j
			sum += overlapTerm(m, k, o);
		}
		// Lines that don't touch this node but might run through it.
		for (let e = 0; e < E; e++) if (m.mark[e] !== stamp) sum += throughTerm(m, e, k);
	}
	for (const e of edges) {
		sum += lengthTerm(m, e);
		for (let f = 0; f < E; f++) {
			if (f === e || (m.mark[f] === stamp && f < e)) continue;
			sum += crossTerm(m, e, f) + labelPairTerm(m, e, f);
		}
		for (let k = 0; k < m.n; k++) sum += throughTerm(m, e, k);
	}
	return sum;
}

function totalLoss(m: Model): number {
	let sum = 0;
	for (let i = 0; i < m.n; i++) {
		sum += spreadTerm(m, i);
		for (let j = i + 1; j < m.n; j++) sum += overlapTerm(m, i, j);
	}
	for (let e = 0; e < m.ea.length; e++) {
		sum += lengthTerm(m, e);
		for (let f = e + 1; f < m.ea.length; f++) sum += crossTerm(m, e, f) + labelPairTerm(m, e, f);
		for (let k = 0; k < m.n; k++) sum += throughTerm(m, e, k);
	}
	return sum;
}

/** The loss of a layout as given (lower is tidier). */
export function layoutLoss(nodes: LayoutNode[], edges: LayoutEdge[], weights?: Partial<LayoutWeights>): number {
	return totalLoss(build(nodes, edges, weights));
}

/** How many pairs of connections cross in a layout. */
export function countCrossings(nodes: LayoutNode[], edges: LayoutEdge[]): number {
	const m = build(nodes, edges, { crossing: 1 });
	let count = 0;
	for (let e = 0; e < m.ea.length; e++) for (let f = e + 1; f < m.ea.length; f++) count += crossTerm(m, e, f);
	return count;
}

/** Small, fast, seedable PRNG (mulberry32). */
function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** One simulated-annealing run from the model's current positions. */
function anneal(m: Model, seed: number, steps: number, budget: number) {
	const random = rng(seed);
	const gauss = () => {
		// Box–Muller
		const u = 1 - random();
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
	};

	// How far a move goes, and how willing we are to accept a worse layout,
	// both shrink as the search goes on.
	let spanX = 0;
	let spanY = 0;
	for (let i = 0; i < m.n; i++) {
		spanX = Math.max(spanX, Math.abs(m.x[i] - m.cx));
		spanY = Math.max(spanY, Math.abs(m.y[i] - m.cy));
	}
	const stepStart = Math.min(400, Math.max(120, (spanX + spanY) / 3));
	const stepEnd = 4;
	const tempStart = 1.5;
	const tempEnd = 0.002;

	let loss = totalLoss(m);
	let best = loss;
	let bestX = m.x.slice();
	let bestY = m.y.slice();

	const started = performance.now();
	let timeUsed = 0;
	for (let s = 0; s < steps; s++) {
		if ((s & 255) === 0) timeUsed = (performance.now() - started) / budget;
		const p = Math.max(s / steps, timeUsed);
		if (p >= 1) break;
		const temp = tempStart * Math.pow(tempEnd / tempStart, p);
		const step = stepStart * Math.pow(stepEnd / stepStart, p);

		const i = Math.floor(random() * m.n);
		const swap = random() < 0.08;
		const j = swap ? Math.floor(random() * m.n) : -1;
		if (swap && j === i) continue;
		const before = localLoss(m, i, j);
		const ox = m.x[i];
		const oy = m.y[i];
		if (swap) {
			m.x[i] = m.x[j];
			m.y[i] = m.y[j];
			m.x[j] = ox;
			m.y[j] = oy;
		} else {
			m.x[i] += gauss() * step;
			m.y[i] += gauss() * step;
		}
		const delta = localLoss(m, i, j) - before;

		if (delta <= 0 || random() < Math.exp(-delta / temp)) {
			loss += delta;
			if (loss < best - 1e-9) {
				best = loss;
				bestX = m.x.slice();
				bestY = m.y.slice();
			}
		} else if (swap) {
			m.x[j] = m.x[i];
			m.y[j] = m.y[i];
			m.x[i] = ox;
			m.y[i] = oy;
		} else {
			m.x[i] = ox;
			m.y[i] = oy;
		}
	}
	return { loss: best, x: bestX, y: bestY };
}

/**
 * New positions for every node, lowering the loss from where they are now.
 * Returns the best layout found, re-centred on the original middle.
 */
export function optimizeLayout(
	nodes: LayoutNode[],
	edges: LayoutEdge[],
	{ weights, iterations, restarts, seed = 1, timeBudget = 5000 }: LayoutOptions = {}
): Map<string, { x: number; y: number }> {
	const m = build(nodes, edges, weights);
	const out = new Map<string, { x: number; y: number }>();
	if (m.n < 2) {
		nodes.forEach((nd) => out.set(nd.id, { x: nd.x, y: nd.y }));
		return out;
	}
	const steps = iterations ?? Math.min(60_000, Math.max(4_000, m.n * 500));
	// Annealing is a random search, so on a typical map run it a few times
	// from the same start and keep the best; a big map gets one longer run.
	const runs = restarts ?? (m.n <= 80 ? 6 : 1);
	const x0 = m.x.slice();
	const y0 = m.y.slice();
	let won: ReturnType<typeof anneal> | null = null;
	for (let r = 0; r < runs; r++) {
		m.x.set(x0);
		m.y.set(y0);
		const run = anneal(m, seed + r * 7919, steps, timeBudget / runs);
		if (!won || run.loss < won.loss) won = run;
	}
	const bestX = won!.x;
	const bestY = won!.y;

	// Keep the map where it was on screen.
	let bx = 0;
	let by = 0;
	for (let i = 0; i < m.n; i++) {
		bx += bestX[i] / m.n;
		by += bestY[i] / m.n;
	}
	nodes.forEach((nd, i) => out.set(nd.id, { x: bestX[i] - bx + m.cx, y: bestY[i] - by + m.cy }));
	return out;
}

/**
 * optimizeLayout, run in a Web Worker where the browser has them, so a long
 * search doesn't freeze the page. Falls back to running it here.
 */
export async function optimizeLayoutInBackground(
	nodes: LayoutNode[],
	edges: LayoutEdge[],
	options: LayoutOptions = {}
): Promise<Map<string, { x: number; y: number }>> {
	if (typeof Worker === 'undefined') return optimizeLayout(nodes, edges, options);
	try {
		const worker = new Worker(new URL('./graph-layout.worker.ts', import.meta.url), { type: 'module' });
		try {
			const result = await new Promise<[string, { x: number; y: number }][]>((resolve, reject) => {
				worker.onmessage = (e) => resolve(e.data);
				worker.onerror = (e) => reject(e);
				worker.postMessage({ nodes, edges, options });
			});
			return new Map(result);
		} finally {
			worker.terminate();
		}
	} catch {
		return optimizeLayout(nodes, edges, options);
	}
}
