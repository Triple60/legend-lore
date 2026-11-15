<script lang="ts">
	import cytoscape, { type Core, type ElementDefinition, type Position } from 'cytoscape';
	import { onDestroy, onMount, untrack } from 'svelte';
	import { applyGraphFocus } from '#lib/graph-focus.ts';
	import { estimateLabelWidth, GraphPhysics, LABEL_MAX_WIDTH } from '#lib/graph-physics.ts';
	import { prefersReducedMotion } from '#lib/ui/place.ts';
	import type { LoreEdge, LoreNode, NodeType } from '#lib/types.ts';
	import { theme } from '#lib/theme.svelte.ts';

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
		/** A right-click on empty canvas, at a point relative to the graph's top-left. */
		onmenu: (at: Position) => void;
		/** Shift+click on a node while another is selected: connect selected → clicked. */
		onconnect: (fromId: string, toId: string) => void;
		/** Text typed into the label editor of an unlabelled edge. */
		onannotate: (edgeId: string, annotation: string) => void;
	}

	let {
		campaignId,
		nodes,
		edges,
		types,
		selectedId,
		highlight,
		onselect,
		onbackground,
		onmenu,
		onconnect,
		onannotate
	}: Props = $props();

	let container: HTMLDivElement;
	let cy: Core | null = $state(null);
	let physics: GraphPhysics | null = null;
	let fitPending = true;
	/** A brand-new map is still finding its shape: fit it once it settles. */
	let fitOnRest = false;

	// --- Inline label editor for an edge ---
	let labelEdgeId = $state<string | null>(null);
	let labelText = $state('');
	let labelPos = $state<Position | null>(null);
	let labelInput = $state<HTMLInputElement | null>(null);

	/** Open the label editor on an edge (once it is on the map). */
	export function editEdgeLabel(id: string) {
		labelEdgeId = id;
		labelText = '';
		placeLabelEditor();
	}

	function placeLabelEditor() {
		const e = labelEdgeId ? cy?.getElementById(labelEdgeId) : null;
		labelPos = e && e.nonempty() ? { ...e.renderedMidpoint() } : null;
	}

	function closeLabelEditor() {
		labelEdgeId = null;
		labelPos = null;
	}

	function commitLabel() {
		const id = labelEdgeId;
		const text = labelText.trim();
		closeLabelEditor();
		if (id && text) onannotate(id, text);
	}

	function onLabelKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitLabel();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			closeLabelEditor();
		}
	}

	$effect(() => {
		if (labelPos) labelInput?.focus();
	});

	// Positions are remembered per browser so the map doesn't reshuffle between
	// visits. They are never synced: each person's map floats on its own, and
	// only the campaign data is shared.
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

	export function fit() {
		cy?.fit(undefined, 40);
		capZoom();
	}

	function fitAnimated() {
		if (!cy) return;
		if (prefersReducedMotion()) return fit();
		cy.animate({ fit: { eles: cy.elements(), padding: 40 } }, { duration: 400, complete: capZoom });
	}

	/** A point on screen (relative to the graph's top-left) in map coordinates. */
	export function toModel(at: Position): Position {
		if (!cy) return at;
		const pan = cy.pan();
		const zoom = cy.zoom();
		return { x: (at.x - pan.x) / zoom, y: (at.y - pan.y) / zoom };
	}

	// Positions asked for nodes that haven't reached the map yet.
	const pendingPlacements = new Map<string, Position>();

	/** Put a node at a map position, now or as soon as it appears. */
	export function placeAt(id: string, pos: Position) {
		const n = cy?.getElementById(id);
		if (n && n.nonempty()) {
			physics?.moveTo(id, pos);
			savePositions();
		} else pendingPlacements.set(id, pos);
	}

	export function focus(id: string) {
		const n = cy?.getElementById(id);
		if (n && n.nonempty()) cy?.animate({ center: { eles: n }, zoom: Math.max(cy.zoom(), 1) }, { duration: 300 });
	}

	// Edge annotations are drawn at this size, in Cytoscape's default font.
	const EDGE_FONT = '10px "Helvetica Neue", Helvetica, sans-serif';
	let measureCtx: CanvasRenderingContext2D | null | undefined;
	/** How wide an annotation is drawn, so its connection can be long enough. */
	function labelWidth(text: string): number {
		if (measureCtx === undefined) {
			try {
				measureCtx = document.createElement('canvas').getContext('2d');
			} catch {
				measureCtx = null;
			}
			if (measureCtx) measureCtx.font = EDGE_FONT;
		}
		const w = measureCtx?.measureText(text).width;
		return typeof w === 'number' && w > 0 ? w : estimateLabelWidth(text);
	}

	// Map styles, built from the current colour tokens. Called again whenever
	// the light/dark theme changes, since Cytoscape draws on a canvas and can't
	// read CSS variables itself.
	function graphStyle(): cytoscape.StylesheetJson {
		const text = cssVar('--text', '#ddd');
		const bg = cssVar('--bg', '#111');
		const muted = cssVar('--muted', '#999');
		const accent = cssVar('--accent', '#d4a24c');
		return [
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
					// Long annotations wrap; their connection grows to fit (graph-physics.ts).
					'text-wrap': 'wrap',
					'text-max-width': `${LABEL_MAX_WIDTH}px`,
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
		];
	}

	onMount(() => {
		cy = cytoscape({
			container,
			minZoom: 0.1,
			maxZoom: 3,
			style: graphStyle()
		});
		physics = new GraphPhysics(cy, {
			reducedMotion: prefersReducedMotion,
			labelWidth,
			onrest: () => {
				savePositions();
				if (fitOnRest) {
					fitOnRest = false;
					fitAnimated();
				}
			}
		});

		cy.on('tap', 'node', (e) => {
			const id = e.target.id();
			const shift = (e.originalEvent as MouseEvent | undefined)?.shiftKey;
			if (shift && selectedId && selectedId !== id) onconnect(selectedId, id);
			else onselect(id);
		});
		cy.on('tap', 'edge', (e) => {
			if (!e.target.data('label')) editEdgeLabel(e.target.id());
		});
		cy.on('tap', (e) => {
			// Cytoscape doesn't fire tap after a pan-drag, so this is a real click.
			if (e.target === cy) onbackground();
		});
		// Right-click, or a long press on touch screens.
		cy.on('cxttap taphold', (e) => {
			if (e.target === cy) onmenu({ ...e.renderedPosition });
		});
		cy.on('dragfree', 'node', savePositions);
		// Keep the label editor on its edge as the map moves.
		cy.on('viewport', placeLabelEditor);
		cy.on('position', 'node', placeLabelEditor);
	});

	onDestroy(() => {
		physics?.destroy();
		cy?.destroy();
	});

	// Recolour the map when the theme flips. While the page's colours fade
	// (see theme.svelte.ts), follow them frame by frame, since the canvas
	// can't transition on its own.
	$effect(() => {
		void theme.current;
		const fading = theme.fading;
		untrack(() => cy?.style(graphStyle()));
		if (!fading) return;
		let frame = requestAnimationFrame(function step() {
			cy?.style(graphStyle());
			frame = requestAnimationFrame(step);
		});
		return () => {
			cancelAnimationFrame(frame);
			cy?.style(graphStyle());
		};
	});

	// Sync Svelte state → Cytoscape elements, adding/removing/updating in place
	// so existing nodes keep their positions.
	$effect(() => {
		if (!cy) return;
		const g = cy;
		const saved = loadPositions();
		const nodeIds = new Set(nodes.map((n) => n.id));
		const edgeIds = new Set(edges.map((e) => e.id));
		let fresh = false;
		let placedPending = false;

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
				let position = pendingPlacements.get(n.id) ?? saved[n.id];
				if (pendingPlacements.delete(n.id)) placedPending = true;
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
					if (firstLoad) fresh = true;
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
		untrack(() => physics?.sync({ fresh }));
		if (placedPending) savePositions();

		if (fitPending && g.nodes().nonempty()) {
			g.fit(undefined, 40);
			capZoom();
			fitOnRest = fresh;
		}
		if (g.nodes().nonempty()) fitPending = false;

		// An edge just created (or filtered back in) can now take its editor.
		untrack(() => {
			if (!labelEdgeId) return;
			if (edgeIds.has(labelEdgeId)) placeLabelEditor();
			else closeLabelEditor();
		});
	});
</script>

<!-- The map has its own right-click menu. -->
<div class="wrap" role="presentation" oncontextmenu={(e) => e.preventDefault()}>
	<div class="graph" bind:this={container}></div>
	{#if labelPos}
		<input
			class="edge-label"
			bind:this={labelInput}
			bind:value={labelText}
			style:left="{labelPos.x}px"
			style:top="{labelPos.y}px"
			placeholder="annotation"
			aria-label="Connection annotation"
			maxlength="500"
			onkeydown={onLabelKey}
			onblur={commitLabel}
		/>
	{/if}
</div>

<style>
	.wrap {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 300px;
	}
	.graph {
		width: 100%;
		height: 100%;
		min-height: 300px;
	}
	.edge-label {
		position: absolute;
		transform: translate(-50%, -50%);
		width: 12rem;
		font-size: 0.8rem;
		padding: 0.2rem 0.4rem;
		z-index: 5;
	}
</style>
