<script lang="ts">
	import cytoscape, { type Core, type ElementDefinition, type Position } from 'cytoscape';
	import { onDestroy, onMount } from 'svelte';
	import { applyGraphFocus } from '#lib/graph-focus.ts';
	import type { LoreEdge, LoreNode, NodeType } from '#lib/types.ts';

	interface Props {
		campaignId: string;
		nodes: LoreNode[];
		edges: LoreEdge[];
		types: Record<string, NodeType>;
		selectedId: string | null;
		/** Search results: when set, nodes outside it are faded. */
		highlight: Set<string> | null;
		onselect: (id: string | null) => void;
		/** A click/tap on empty canvas (not on a node or edge). */
		onbackground: () => void;
	}

	let { campaignId, nodes, edges, types, selectedId, highlight, onselect, onbackground }: Props = $props();

	let container: HTMLDivElement;
	let cy: Core | null = $state(null);
	let fitPending = true;

	// Layout positions are remembered per browser so the map doesn't reshuffle
	// between visits. This is a viewer convenience only; nothing depends on it.
	const posKey = () => `legend-lore:positions:${campaignId}`;
	function loadPositions(): Record<string, Position> {
		try {
			return JSON.parse(localStorage.getItem(posKey()) ?? '{}');
		} catch {
			return {};
		}
	}
	function savePositions() {
		if (!cy) return;
		const out: Record<string, Position> = {};
		cy.nodes().forEach((n) => {
			out[n.id()] = { ...n.position() };
		});
		try {
			localStorage.setItem(posKey(), JSON.stringify(out));
		} catch {
			/* storage unavailable: layout just won't persist */
		}
	}

	// Deterministic pseudo-random number from an id, for stable placement.
	function hash(s: string) {
		let h = 2166136261;
		for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
		return (h >>> 0) / 4294967295;
	}

	function seedPosition(id: string, index: number): Position {
		const angle = hash(id) * Math.PI * 2;
		const r = 80 * Math.sqrt(index + 1);
		return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
	}

	function cssVar(name: string, fallback: string) {
		return getComputedStyle(container).getPropertyValue(name).trim() || fallback;
	}

	// Never zoom in so far that a small graph looks blown up.
	function capZoom() {
		if (cy && cy.zoom() > 1.25) {
			cy.zoom(1.25);
			cy.center();
		}
	}

	// Force-directed layout. randomize:false starts from current positions, so
	// re-running it refines the map rather than reshuffling it. The force
	// constants follow Cytoscape's own cose demo, which spreads nodes out far
	// more than the library defaults.
	function runLayout(animate: boolean) {
		cy?.layout({
			name: 'cose',
			randomize: false,
			animate,
			animationDuration: 500,
			fit: true,
			padding: 40,
			nodeDimensionsIncludeLabels: true,
			idealEdgeLength: () => 100,
			edgeElasticity: () => 100,
			nodeRepulsion: () => 400000,
			nodeOverlap: 20,
			gravity: 80,
			numIter: 1000,
			initialTemp: 200,
			coolingFactor: 0.95,
			minTemp: 1.0,
			stop: () => {
				capZoom();
				savePositions();
			}
		} as cytoscape.LayoutOptions).run();
	}

	export function relayout() {
		runLayout(true);
	}

	export function focus(id: string) {
		const n = cy?.getElementById(id);
		if (n && n.nonempty()) cy?.animate({ center: { eles: n }, zoom: Math.max(cy.zoom(), 1) }, { duration: 300 });
	}

	onMount(() => {
		const text = cssVar('--text', '#ddd');
		const bg = cssVar('--bg', '#111');
		const muted = cssVar('--muted', '#999');
		const accent = cssVar('--accent', '#d4a24c');

		cy = cytoscape({
			container,
			minZoom: 0.1,
			maxZoom: 3,
			style: [
				{
					selector: 'node',
					style: {
						'background-color': 'data(color)',
						label: 'data(label)',
						color: text,
						'font-size': 12,
						'text-valign': 'bottom',
						'text-margin-y': 4,
						'text-outline-color': bg,
						'text-outline-width': 2,
						width: 26,
						height: 26
					}
				},
				{
					selector: 'edge',
					style: {
						width: 1.5,
						'line-color': muted,
						'target-arrow-color': muted,
						'target-arrow-shape': 'triangle',
						'curve-style': 'bezier',
						label: 'data(label)',
						'font-size': 10,
						color: muted,
						'text-rotation': 'autorotate',
						'text-background-color': bg,
						'text-background-opacity': 0.85,
						'text-background-padding': '2px'
					}
				},
				{ selector: 'node.selected', style: { 'border-width': 3, 'border-color': accent, width: 34, height: 34 } },
				{
					selector: 'edge.connected',
					style: { width: 3, 'line-color': accent, 'target-arrow-color': accent, color: text, 'z-index': 10 }
				},
				{ selector: '.faded', style: { opacity: 0.15 } }
			]
		});

		cy.on('tap', 'node', (e) => onselect(e.target.id()));
		cy.on('tap', (e) => {
			// Cytoscape doesn't fire tap after a pan-drag, so this is a real click.
			if (e.target === cy) onbackground();
		});
		cy.on('dragfree', 'node', savePositions);
	});

	onDestroy(() => cy?.destroy());

	// Sync Svelte state → Cytoscape elements, adding/removing/updating in place
	// so existing nodes keep their positions.
	$effect(() => {
		if (!cy) return;
		const g = cy;
		const saved = loadPositions();
		const nodeIds = new Set(nodes.map((n) => n.id));
		const edgeIds = new Set(edges.map((e) => e.id));
		let needsLayout = false;

		g.batch(() => {
			g.elements().forEach((el) => {
				if (!(el.isNode() ? nodeIds : edgeIds).has(el.id())) el.remove();
			});

			const firstLoad = g.nodes().empty();
			const added: ElementDefinition[] = [];
			nodes.forEach((n, i) => {
				const data = { id: n.id, label: n.name, color: types[n.type_id]?.color ?? '#888888' };
				const existing = g.getElementById(n.id);
				if (existing.nonempty()) {
					existing.data(data);
					return;
				}
				let position = saved[n.id];
				if (!position) {
					// Place new nodes beside an already-placed neighbour if possible.
					const neighbour = edges
						.map((e) => (e.from_id === n.id ? e.to_id : e.to_id === n.id ? e.from_id : null))
						.map((id) => (id ? g.getElementById(id) : null))
						.find((el) => el?.nonempty());
					const offset = seedPosition(n.id, 0);
					position = neighbour
						? { x: neighbour.position().x + offset.x, y: neighbour.position().y + offset.y }
						: seedPosition(n.id, i);
					if (firstLoad) needsLayout = true;
				}
				added.push({ group: 'nodes', data, position });
			});
			g.add(added);

			for (const e of edges) {
				const data = { id: e.id, source: e.from_id, target: e.to_id, label: e.annotation };
				const existing = g.getElementById(e.id);
				if (existing.nonempty()) existing.data(data);
				else g.add({ group: 'edges', data });
			}
		});

		applyGraphFocus(g, selectedId, highlight);

		if (needsLayout) runLayout(false);
		else if (fitPending && g.nodes().nonempty()) {
			g.fit(undefined, 40);
			capZoom();
		}
		if (g.nodes().nonempty()) fitPending = false;
	});
</script>

<div class="graph" bind:this={container}></div>

<style>
	.graph {
		width: 100%;
		height: 100%;
		min-height: 300px;
	}
</style>
