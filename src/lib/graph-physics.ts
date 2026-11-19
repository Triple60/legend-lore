import type { Core, NodeSingular, Position } from 'cytoscape';
import {
	forceCollide,
	forceLink,
	forceManyBody,
	forceSimulation,
	forceX,
	forceY,
	type Simulation,
	type SimulationLinkDatum,
	type SimulationNodeDatum
} from 'd3-force';

/**
 * Live physics for the map: nodes push each other apart, connections pull
 * like springs, and dragging a node tugs its neighbours along.
 *
 * This only moves things on this screen. Positions are never sent anywhere,
 * so everyone's map floats in its own way; only the data is shared.
 *
 * The simulation cools down and stops after a few seconds, so an idle map
 * uses no CPU. A drag or a change to the graph wakes it again. When the
 * person asks for reduced motion, it settles instantly instead of animating.
 */

interface SimNode extends SimulationNodeDatum {
	id: string;
}
interface SimLink extends SimulationLinkDatum<SimNode> {
	length: number;
	/** Size of the annotation drawn at the middle of the connection (0 for none). */
	labelWidth: number;
	labelHeight: number;
}

/** How hard a change wakes the simulation (d3 "alpha", 0–1). */
const WAKE = { fresh: 0.8, change: 0.25, drag: 0.3, release: 0.04 } as const;
/** The spring length of a connection with a short (or no) annotation. */
export const BASE_LINK_LENGTH = 110;
/** Node radius on the map (nodes are 26px wide). */
const NODE_RADIUS = 13;
/**
 * Bare arrow left showing on each side of an annotation, so a long label
 * never hides the line or its arrowhead.
 */
export const ARROW_CLEARANCE = 28;
/** Widest an annotation gets before it wraps onto more lines (see Graph.svelte). */
export const LABEL_MAX_WIDTH = 220;

/**
 * Spring length for a connection whose annotation is `labelWidth` pixels
 * wide: at least the base length, and long enough that the label plus clear
 * arrow on both sides fits between the two nodes.
 */
export function linkLength(labelWidth: number): number {
	const label = Math.min(Math.max(0, labelWidth), LABEL_MAX_WIDTH);
	return Math.max(BASE_LINK_LENGTH, label + 2 * (ARROW_CLEARANCE + NODE_RADIUS));
}

/** A rough label width, for when text can't be measured (no canvas). */
export const estimateLabelWidth = (text: string) => text.length * 5.6;

/** Height of one line of annotation, with its background padding. */
const LABEL_LINE_HEIGHT = 13;
/**
 * How big an annotation `labelWidth` pixels wide is drawn: long ones wrap at
 * LABEL_MAX_WIDTH onto more lines.
 */
export function labelBox(labelWidth: number): { width: number; height: number } {
	if (labelWidth <= 0) return { width: 0, height: 0 };
	const lines = Math.max(1, Math.ceil(labelWidth / LABEL_MAX_WIDTH));
	return { width: Math.min(labelWidth, LABEL_MAX_WIDTH) + 4, height: lines * LABEL_LINE_HEIGHT + 4 };
}

/** Room a node (with its name under it) wants between itself and a line. */
export const LINE_CLEARANCE = 26;
/** How hard a line and a node on it push apart (per tick, like forceCollide). */
const LINE_PUSH = 0.25;

/**
 * Keep nodes off connections they aren't part of: a node lying on a line, or
 * on the annotation in its middle, is pushed off to the side it's on, and
 * the line's two ends are pushed the other way, so the two part like any
 * other pair of bodies. The annotation is treated as a box around the
 * middle of the line, turned with it (as it is drawn).
 */
function forceLineClearance(links: () => SimLink[]) {
	let nodes: SimNode[] = [];
	const force = () => {
		for (const l of links()) {
			const a = l.source;
			const b = l.target;
			if (typeof a !== 'object' || typeof b !== 'object') continue;
			const ax = a.x ?? 0;
			const ay = a.y ?? 0;
			const vx = (b.x ?? 0) - ax;
			const vy = (b.y ?? 0) - ay;
			const len = Math.hypot(vx, vy);
			if (len < 1) continue;
			const ux = vx / len;
			const uy = vy / len;
			const halfLabel = l.labelWidth / 2;
			const reach = LINE_CLEARANCE + l.labelHeight / 2;
			const minX = Math.min(ax, ax + vx) - reach;
			const maxX = Math.max(ax, ax + vx) + reach;
			const minY = Math.min(ay, ay + vy) - reach;
			const maxY = Math.max(ay, ay + vy) + reach;
			for (const k of nodes) {
				if (k === a || k === b) continue;
				const kx = k.x ?? 0;
				const ky = k.y ?? 0;
				if (kx < minX || kx > maxX || ky < minY || ky > maxY) continue;
				// Where the node is along the line (u) and off to its side (v).
				const u = (kx - ax) * ux + (ky - ay) * uy;
				if (u <= 0 || u >= len) continue; // past the ends: the nodes there push it off
				const v = (kx - ax) * -uy + (ky - ay) * ux;
				const onLabel = Math.abs(u - len / 2) < halfLabel + LINE_CLEARANCE;
				const need = LINE_CLEARANCE + (onLabel ? l.labelHeight / 2 : 0);
				const gap = need - Math.abs(v);
				if (gap <= 0) continue;
				// Straight on the line: pick a side that doesn't depend on rounding.
				const side = v > 0.01 ? 1 : v < -0.01 ? -1 : k.index! % 2 ? 1 : -1;
				const push = gap * LINE_PUSH * side;
				const nx = -uy * push;
				const ny = ux * push;
				// The node takes half; the line's ends share the rest by how near each is.
				const t = u / len;
				k.vx = (k.vx ?? 0) + nx / 2;
				k.vy = (k.vy ?? 0) + ny / 2;
				a.vx = (a.vx ?? 0) - (nx / 2) * (1 - t);
				a.vy = (a.vy ?? 0) - (ny / 2) * (1 - t);
				b.vx = (b.vx ?? 0) - (nx / 2) * t;
				b.vy = (b.vy ?? 0) - (ny / 2) * t;
			}
		}
	};
	force.initialize = (n: SimNode[]) => {
		nodes = n;
	};
	return force;
}

/** Ticks to run in one go when settling without animation. */
const INSTANT_TICKS = 300;

export interface PhysicsOptions {
	/** Settle instantly instead of animating (prefers-reduced-motion). */
	reducedMotion?: () => boolean;
	/** Called each time the map comes to rest. */
	onrest?: () => void;
	/** Width in pixels of an edge annotation as drawn on the map. */
	labelWidth?: (text: string) => number;
}

export class GraphPhysics {
	#cy: Core;
	#sim: Simulation<SimNode, SimLink>;
	#links = forceLink<SimNode, SimLink>()
		.id((d) => d.id)
		.distance((l) => l.length)
		.strength(0.4);
	#byId = new Map<string, SimNode>();
	#edgeKey = '';
	#reduced: () => boolean;
	#onrest: () => void;
	#labelWidth: (text: string) => number;
	/** Nodes being dragged right now. */
	#dragging = new Set<string>();
	/** The animation frame of a glide in progress (see animateTo). */
	#tween: number | null = null;
	/** A wake that arrived during a glide, to run once it ends. */
	#pendingWake = 0;

	constructor(
		cy: Core,
		{ reducedMotion = () => false, onrest = () => {}, labelWidth = estimateLabelWidth }: PhysicsOptions = {}
	) {
		this.#cy = cy;
		this.#labelWidth = labelWidth;
		this.#reduced = reducedMotion;
		this.#onrest = onrest;
		this.#sim = forceSimulation<SimNode>([])
			.velocityDecay(0.3) // a little floatier than d3's default 0.4
			.force('charge', forceManyBody<SimNode>().strength(-320).distanceMax(700))
			.force('link', this.#links)
			.force('collide', forceCollide<SimNode>(32))
			// Nodes stay off connections (and their annotations) that they aren't on.
			.force('lines', forceLineClearance(() => this.#links.links()))
			// A gentle pull to the middle keeps unconnected nodes in the cloud.
			.force('x', forceX<SimNode>(0).strength(0.03))
			.force('y', forceY<SimNode>(0).strength(0.03))
			.on('tick', () => this.#apply())
			.on('end', () => this.#onrest())
			.stop();

		cy.on('grab', 'node', this.#grab);
		cy.on('drag', 'node', this.#drag);
		cy.on('free', 'node', this.#free);
	}

	/**
	 * Match the simulation to the nodes and edges on the map. New nodes start
	 * wherever they were put on the map. `fresh` means nothing had a saved
	 * position yet, so the whole map should find its shape.
	 */
	sync({ fresh = false } = {}) {
		const cy = this.#cy;
		let changed = false;

		const next = new Map<string, SimNode>();
		cy.nodes().forEach((n) => {
			let s = this.#byId.get(n.id());
			if (!s) {
				s = { id: n.id(), ...n.position() };
				changed = true;
			}
			next.set(s.id, s);
		});
		if (next.size !== this.#byId.size) changed = true;
		this.#byId = next;

		const links: SimLink[] = [];
		cy.edges().forEach((e) => {
			const source = e.source().id();
			const target = e.target().id();
			const label = String(e.data('label') ?? '');
			const width = label ? this.#labelWidth(label) : 0;
			const box = labelBox(width);
			if (source !== target)
				links.push({ source, target, length: linkLength(width), labelWidth: box.width, labelHeight: box.height });
		});
		const edgeKey = links
			.map((l) => `${l.source}>${l.target}:${Math.round(l.length)}:${Math.round(l.labelHeight)}`)
			.join('|');
		if (edgeKey !== this.#edgeKey) changed = true;
		this.#edgeKey = edgeKey;

		this.#sim.nodes([...next.values()]);
		this.#links.links(links);

		if (fresh) this.#wake(WAKE.fresh);
		else if (changed) this.#wake(WAKE.change);
	}

	/** Move a node to a spot on the map (e.g. where it was created). */
	moveTo(id: string, pos: Position) {
		const s = this.#byId.get(id);
		if (!s) return;
		s.x = pos.x;
		s.y = pos.y;
		s.vx = s.vy = 0;
		this.#cy.getElementById(id).position(pos);
		this.#wake(WAKE.change);
	}

	/** Where every node is, and every connection with its natural length. */
	snapshot(): {
		nodes: { id: string; x: number; y: number }[];
		links: { source: string; target: string; length: number; labelWidth: number; labelHeight: number }[];
	} {
		const id = (end: string | number | SimNode) => (typeof end === 'object' ? end.id : String(end));
		return {
			nodes: [...this.#byId.values()].map((s) => ({ id: s.id, x: s.x ?? 0, y: s.y ?? 0 })),
			links: this.#links.links().map((l) => ({
				source: id(l.source),
				target: id(l.target),
				length: l.length,
				labelWidth: l.labelWidth,
				labelHeight: l.labelHeight
			}))
		};
	}

	/**
	 * Where nodes placed at `targets` would come to rest under the map's
	 * forces, worked out without moving anything on screen. Lets a new layout
	 * be adjusted so the live physics won't pull it about afterwards.
	 */
	relaxed(targets: Map<string, Position>, maxTicks = 600): Map<string, Position> {
		const nodes = [...this.#byId.values()];
		const saved = nodes.map((s) => ({ x: s.x, y: s.y, vx: s.vx, vy: s.vy }));
		const alpha = this.#sim.alpha();
		for (const s of nodes) {
			const t = targets.get(s.id);
			if (t) {
				s.x = t.x;
				s.y = t.y;
			}
			s.vx = s.vy = 0;
		}
		// Run until the simulation has cooled right down, as the live map would,
		// so there's nothing left for it to move once the nodes are there.
		this.#sim.alpha(0.3);
		for (let t = 0; t < maxTicks && this.#sim.alpha() > this.#sim.alphaMin(); t++) this.#sim.tick();
		const out = new Map(nodes.map((s) => [s.id, { x: s.x ?? 0, y: s.y ?? 0 }]));
		nodes.forEach((s, i) => Object.assign(s, saved[i]));
		this.#sim.alpha(alpha);
		return out;
	}

	/**
	 * Glide every node to a new position, then rest there. With reduced
	 * motion they jump straight to it. Grabbing a node stops the glide where
	 * it is and hands the map back to the physics.
	 */
	animateTo(targets: Map<string, Position>, duration = 900, { release = false } = {}) {
		this.#stopTween();
		this.#sim.alphaTarget(0).stop();
		const nodes = [...this.#byId.values()].filter((s) => targets.has(s.id));
		const from = nodes.map((s) => ({ x: s.x ?? 0, y: s.y ?? 0 }));
		const finish = () => {
			this.#tween = null;
			for (const s of nodes) s.vx = s.vy = 0;
			this.#sim.alpha(0);
			this.#apply();
			this.#onrest();
			// Let the physics loose again, gently, so any small difference from
			// its own resting place settles now rather than at the next touch.
			const pending = Math.max(this.#pendingWake, release ? WAKE.release : 0);
			this.#pendingWake = 0;
			if (pending) this.#wake(pending);
		};
		const place = (k: number) => {
			nodes.forEach((s, i) => {
				const t = targets.get(s.id)!;
				s.x = from[i].x + (t.x - from[i].x) * k;
				s.y = from[i].y + (t.y - from[i].y) * k;
			});
		};
		if (this.#reduced() || duration <= 0 || nodes.length === 0) {
			place(1);
			finish();
			return;
		}
		const start = performance.now();
		const step = (now: number) => {
			const t = Math.min(1, (now - start) / duration);
			place(easeInOutCubic(t));
			if (t < 1) {
				this.#apply();
				this.#tween = requestAnimationFrame(step);
			} else finish();
		};
		this.#tween = requestAnimationFrame(step);
	}

	#stopTween() {
		if (this.#tween !== null) cancelAnimationFrame(this.#tween);
		this.#tween = null;
	}

	destroy() {
		this.#stopTween();
		this.#sim.stop();
		this.#cy.off('grab', 'node', this.#grab);
		this.#cy.off('drag', 'node', this.#drag);
		this.#cy.off('free', 'node', this.#free);
	}

	#wake(alpha: number) {
		if (this.#byId.size === 0) return;
		if (this.#tween !== null) {
			// Don't fight a glide in progress; wake once it lands.
			this.#pendingWake = Math.max(this.#pendingWake, alpha);
			return;
		}
		if (this.#reduced()) {
			this.#sim.alpha(Math.max(this.#sim.alpha(), alpha)).stop();
			this.#sim.tick(INSTANT_TICKS);
			this.#apply();
			this.#onrest();
		} else {
			this.#sim.alpha(Math.max(this.#sim.alpha(), alpha)).restart();
		}
	}

	/** Copy simulated positions onto the map. */
	#apply() {
		const cy = this.#cy;
		cy.batch(() => {
			for (const s of this.#byId.values()) {
				const n = cy.getElementById(s.id);
				// The node under the pointer goes where the pointer is.
				if (n.nonempty() && !n.grabbed()) n.position({ x: s.x ?? 0, y: s.y ?? 0 });
			}
		});
	}

	#pin(n: NodeSingular) {
		const s = this.#byId.get(n.id());
		if (!s) return;
		const p = n.position();
		s.fx = s.x = p.x;
		s.fy = s.y = p.y;
	}

	// A grab is also the start of a plain click, so the simulation only warms
	// up once the node actually moves.
	#grab = (e: { target: NodeSingular }) => {
		if (this.#tween !== null) {
			// Stop a glide where it is; the physics takes it from here.
			this.#stopTween();
			this.#pendingWake = 0;
		}
		this.#pin(e.target);
	};

	#drag = (e: { target: NodeSingular }) => {
		this.#pin(e.target);
		if (this.#dragging.has(e.target.id())) return;
		this.#dragging.add(e.target.id());
		// Keep the simulation warm while dragging so neighbours follow.
		if (!this.#reduced()) this.#sim.alphaTarget(WAKE.drag).restart();
	};

	#free = (e: { target: NodeSingular }) => {
		const s = this.#byId.get(e.target.id());
		const moved = this.#dragging.delete(e.target.id());
		if (moved && this.#reduced()) {
			// Settle around the dropped node, then let it go.
			this.#pin(e.target);
			this.#wake(WAKE.change);
		} else if (moved && this.#dragging.size === 0) {
			this.#sim.alphaTarget(0);
		}
		if (s) s.fx = s.fy = null;
	};
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
