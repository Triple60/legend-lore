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
type SimLink = SimulationLinkDatum<SimNode>;

/** How hard a change wakes the simulation (d3 "alpha", 0–1). */
const WAKE = { fresh: 0.8, change: 0.25, drag: 0.3 } as const;
/** Ticks to run in one go when settling without animation. */
const INSTANT_TICKS = 300;

export interface PhysicsOptions {
	/** Settle instantly instead of animating (prefers-reduced-motion). */
	reducedMotion?: () => boolean;
	/** Called each time the map comes to rest. */
	onrest?: () => void;
}

export class GraphPhysics {
	#cy: Core;
	#sim: Simulation<SimNode, SimLink>;
	#links = forceLink<SimNode, SimLink>()
		.id((d) => d.id)
		.distance(110)
		.strength(0.4);
	#byId = new Map<string, SimNode>();
	#edgeKey = '';
	#reduced: () => boolean;
	#onrest: () => void;
	/** Nodes being dragged right now. */
	#dragging = new Set<string>();

	constructor(cy: Core, { reducedMotion = () => false, onrest = () => {} }: PhysicsOptions = {}) {
		this.#cy = cy;
		this.#reduced = reducedMotion;
		this.#onrest = onrest;
		this.#sim = forceSimulation<SimNode>([])
			.velocityDecay(0.3) // a little floatier than d3's default 0.4
			.force('charge', forceManyBody<SimNode>().strength(-320).distanceMax(700))
			.force('link', this.#links)
			.force('collide', forceCollide<SimNode>(32))
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
			if (source !== target) links.push({ source, target });
		});
		const edgeKey = links.map((l) => `${l.source}>${l.target}`).join('|');
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

	destroy() {
		this.#sim.stop();
		this.#cy.off('grab', 'node', this.#grab);
		this.#cy.off('drag', 'node', this.#drag);
		this.#cy.off('free', 'node', this.#free);
	}

	#wake(alpha: number) {
		if (this.#byId.size === 0) return;
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
	#grab = (e: { target: NodeSingular }) => this.#pin(e.target);

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
