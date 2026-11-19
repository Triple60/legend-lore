<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { CampaignStore, type NodeInput } from '#lib/campaign.svelte.ts';
	import Graph from '#lib/components/Graph.svelte';
	import NodeForm from '#lib/components/NodeForm.svelte';
	import NodePanel from '#lib/components/NodePanel.svelte';
	import NodeQuickForm from '#lib/components/NodeQuickForm.svelte';
	import TypeEditor from '#lib/components/TypeEditor.svelte';
	import type { NodeType } from '#lib/types.ts';
	import Menu from '#lib/ui/Menu.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import Popover from '#lib/ui/Popover.svelte';
	import type { Point } from '#lib/ui/place.ts';
	import { prefersReducedMotion } from '#lib/ui/place.ts';
	import { fly } from 'svelte/transition';
	import { filterGraph } from '#lib/filter.ts';
	import { searchNodes } from '#lib/search.ts';
	import { SHORTCUTS, loadShortcutsEnabled, saveShortcutsEnabled, shortcutFor } from '#lib/shortcuts.ts';
	import { auth } from '#lib/session.svelte.ts';
	import { untrack } from 'svelte';
	import { debug, short } from '#lib/debug.svelte.ts';

	const campaignId = $derived(page.url.searchParams.get('id') ?? '');

	let store = $state<CampaignStore | null>(null);
	let graph = $state<ReturnType<typeof Graph> | null>(null);

	// Depend on the user id only: token refreshes replace the session object
	// but shouldn't tear down and reload the whole campaign.
	const userId = $derived(auth.user?.id ?? null);

	$effect(() => {
		if (!userId) {
			debug.log('campaign page: not logged in, going to login');
			const here = `${resolve('/campaign')}?id=${encodeURIComponent(campaignId)}`;
			goto(`${resolve('/login')}?next=${encodeURIComponent(here)}`, { replaceState: true });
			return;
		}
		const meta = untrack(() => auth.user);
		const name = meta?.user_metadata?.full_name ?? meta?.user_metadata?.name ?? meta?.email ?? 'Adventurer';
		debug.log('campaign page: starting', `user=${short(userId)} campaign=${short(campaignId)}`);
		const s = new CampaignStore(campaignId, { id: userId, name });
		store = s;
		s.load();
		return () => {
			debug.log('campaign page: stopping', 'the login or campaign changed, or the page was left');
			s.destroy();
		};
	});

	// --- View state ---
	let selectedId = $state<string | null>(null);
	let query = $state('');
	let hiddenTypes = $state<string[]>([]);
	let asOfSession = $state<number | null>(null);
	let saving = $state(false);
	let createError = $state<string | null>(null);

	/** Right-click menu on the map, at a point relative to the canvas. */
	let menu = $state<Point | null>(null);
	/** Quick-add popover: where it opened, and where on the map the node will go. */
	let quick = $state<{ at: Point; place: Point } | null>(null);
	/** The full new-node form in a side panel, seeded from the popover. */
	let drafting = $state<{ input: Partial<NodeInput>; place: Point | null } | null>(null);

	/** The panel on top of the Campaign panel, if any. */
	const overlay = $derived(drafting ? 'create' : selectedId ? 'node' : null);

	let canvasEl = $state<HTMLDivElement | null>(null);
	let stackEl = $state<HTMLDivElement | null>(null);

	const visible = $derived(
		filterGraph(store?.liveNodes ?? [], store?.liveEdges ?? [], { hiddenTypes, asOfSession: asOfSession ?? null })
	);
	const visibleNodes = $derived(visible.visibleNodes);
	const visibleEdges = $derived(visible.visibleEdges);
	const hits = $derived(searchNodes(visibleNodes, query));
	const highlight = $derived.by(() => {
		if (!query.trim()) return null;
		const ids = new Set(hits.map((h) => h.node.id));
		if (selectedId) ids.add(selectedId);
		return ids;
	});

	/** Select a node; `center` pans the map to it (for picks made off the map). */
	function select(id: string | null, center = true) {
		if (id !== selectedId) debug.log('select', `${short(selectedId)} → ${short(id)}`);
		selectedId = id;
		drafting = null;
		quick = null;
		if (id && center) graph?.focus(id);
	}

	function toggleType(id: string) {
		hiddenTypes = hiddenTypes.includes(id) ? hiddenTypes.filter((t) => t !== id) : [...hiddenTypes, id];
	}

	// --- Campaign panel (collapsible; remembered per browser) ---
	const COLLAPSE_KEY = 'legend-lore:campaign-panel';
	let campaignOpen = $state(readCampaignOpen());
	function readCampaignOpen() {
		// On phones the panel would cover most of the map, so it starts closed there.
		const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches;
		try {
			const saved = localStorage.getItem(COLLAPSE_KEY);
			return saved ? saved === 'open' : !narrow;
		} catch {
			return !narrow;
		}
	}
	function setCampaignOpen(open: boolean) {
		campaignOpen = open;
		try {
			localStorage.setItem(COLLAPSE_KEY, open ? 'open' : 'closed');
		} catch {
			/* storage unavailable: the choice lasts for this visit only */
		}
	}

	const slide = (node: Element) =>
		fly(node, { x: -(node as HTMLElement).offsetWidth - 24, opacity: 1, duration: prefersReducedMotion() ? 0 : 220 });

	// --- Creating nodes ---
	let quickForm = $state<ReturnType<typeof NodeQuickForm> | null>(null);

	/** Open the quick-add popover at a point on the canvas; the node goes there on the map. */
	function quickAdd(at: Point) {
		menu = null;
		drafting = null;
		createError = null;
		quick = { at, place: graph?.toModel(at) ?? at };
	}

	/** The middle of the map area that isn't covered by the side panels. */
	function openSpaceCentre(): Point {
		const c = canvasEl?.getBoundingClientRect();
		if (!c) return { x: 200, y: 200 };
		const s = stackEl?.getBoundingClientRect();
		// Panels sit on the left on wide screens and along the bottom on phones.
		const besidePanels = s && s.width && s.width < c.width / 2;
		const left = besidePanels ? s.right - c.left : 0;
		const bottom = !besidePanels && s && s.height ? s.top - c.top : c.height;
		return { x: (left + c.width) / 2, y: bottom / 2 };
	}

	/** N or "+ New node": open quick-add, or if it's already open, put the cursor back in Name. */
	function newNode() {
		if (quick) quickForm?.focusName();
		else if (drafting) nodeForm?.focusName();
		else quickAdd(openSpaceCentre());
	}

	function expandQuick(input: Partial<NodeInput>) {
		drafting = { input, place: quick?.place ?? null };
		quick = null;
		selectedId = null;
	}

	async function createNode(input: NodeInput, place: Point | null) {
		if (!store) return;
		saving = true;
		createError = null;
		try {
			const n = await store.createNode(input);
			if (place) graph?.placeAt(n.id, place);
			select(n.id);
		} catch (e) {
			createError = (e as Error).message;
		} finally {
			saving = false;
		}
	}

	const menuItems = (at: Point) => [
		{ label: 'New node here', hint: shortcutsOn ? 'N' : undefined, onselect: () => quickAdd(at) },
		{ label: 'Reorganize map', onselect: reorganize },
		{ label: 'Fit map to screen', onselect: () => graph?.fit() }
	];

	// --- Reorganize: the button shows a spinner while the new layout is worked out ---
	let reorganizing = $state(false);
	async function reorganize() {
		if (reorganizing || !graph) return;
		reorganizing = true;
		try {
			await graph.reorganize();
		} finally {
			reorganizing = false;
		}
	}

	// --- Keyboard shortcuts (see #lib/shortcuts.ts) ---
	let shortcutsOn = $state(loadShortcutsEnabled());
	let searchInput = $state<HTMLInputElement | null>(null);
	let nodeForm = $state<ReturnType<typeof NodeForm> | null>(null);

	$effect(() => saveShortcutsEnabled(shortcutsOn));

	function onWindowKey(e: KeyboardEvent) {
		if (!shortcutsOn || !store || store.loading || store.error) return;
		const action = shortcutFor(e, document.activeElement);
		if (!action) return;
		// Stops the key also being typed into the field we're about to focus.
		e.preventDefault();
		if (action === 'search') searchInput?.focus();
		else if (action === 'new-node') newNode();
		else goBack();
	}

	/** Esc: undo one step, the same as the matching Cancel or Close button. */
	function goBack() {
		if (menu) menu = null;
		else if (quick) quick = null;
		else if (drafting) drafting = null;
		else if (selectedId && store?.editing === selectedId) store.endEdit('(Esc on the page)');
		else if (selectedId) select(null);
		else if (query) query = '';
	}

	/**
	 * A click on empty map: close an open menu or pop-up first; otherwise clear
	 * the selection (and its highlight). A node with an edit in progress stays
	 * open so the edit isn't lost.
	 */
	function clickBackground() {
		if (menu || quick) menu = quick = null;
		else if (selectedId && store?.editing !== selectedId && !store?.lostLockTo) select(null);
	}

	function onSearchKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && hits[0]) select(hits[0].node.id);
		if (e.key === 'Escape') query = '';
	}

	// --- Connections drawn on the map ---
	let graphError = $state<string | null>(null);

	/** Shift+click: connect the selected node to another, then ask for its annotation. */
	async function connect(fromId: string, toId: string) {
		if (!store) return;
		graphError = null;
		try {
			const edge = await store.createEdge({ from_id: fromId, to_id: toId, annotation: '', session_number: null });
			graph?.editEdgeLabel(edge.id);
		} catch (e) {
			graphError = (e as Error).message;
		}
	}

	async function annotate(edgeId: string, annotation: string) {
		const edge = store?.edges[edgeId];
		if (!store || !edge) return;
		graphError = null;
		try {
			await store.updateEdge(edge, { annotation });
		} catch (e) {
			graphError = (e as Error).message;
		}
	}

	// --- Sidebar tools (shown when nothing is selected) ---
	let inviteUrl = $state<string | null>(null);
	let toolError = $state<string | null>(null);

	async function invite() {
		toolError = null;
		try {
			const token = await store!.createInvite();
			inviteUrl = `${location.origin}${resolve('/join')}?token=${token}`;
			await navigator.clipboard?.writeText(inviteUrl).catch(() => {});
		} catch (e) {
			toolError = (e as Error).message;
		}
	}

	// --- Node types: add from the "+" after the last one; rename by
	// double-click, right-click or F2 on a type ---
	let typeEditor = $state<{ anchor: HTMLElement; type: NodeType | null } | null>(null);
	let typeSaving = $state(false);
	let typeError = $state<string | null>(null);

	function openTypeEditor(anchor: HTMLElement, type: NodeType | null) {
		typeError = null;
		typeEditor = typeEditor?.anchor === anchor ? null : { anchor, type };
	}

	async function saveType(label: string, color: string) {
		if (!store || !typeEditor) return;
		const { type } = typeEditor;
		typeSaving = true;
		typeError = null;
		try {
			if (type) await store.updateType(type, { label, color });
			else await store.createType(label, color);
			typeEditor = null;
		} catch (e) {
			const msg = (e as Error).message;
			typeError = /duplicate|unique/i.test(msg) ? `There's already a type called “${label}”.` : msg;
		} finally {
			typeSaving = false;
		}
	}

	function onTypeKey(e: KeyboardEvent, t: NodeType) {
		if (e.key === 'F2') {
			e.preventDefault();
			openTypeEditor(e.currentTarget as HTMLElement, t);
		}
	}

	async function restoreNode(id: string) {
		toolError = null;
		try {
			await store!.restoreNode(store!.nodes[id]);
		} catch (e) {
			toolError = (e as Error).message;
		}
	}
</script>

{#if !store || store.loading}
	<p class="muted center">Loading campaign…</p>
{:else if store.error}
	<div class="card problem">
		<p class="error">{store.error}</p>
		<a href={resolve('/')}>Back to your campaigns</a>
	</div>
{:else}
	<div class="toolbar">
		<h1>{store.campaign?.name}</h1>
		<div class="search">
			<input
				type="search"
				bind:this={searchInput}
				bind:value={query}
				onkeydown={onSearchKey}
				aria-keyshortcuts={shortcutsOn ? '/' : undefined}
				placeholder="Search names, aliases, notes, #tags…"
				aria-label="Search"
			/>
			{#if query.trim()}
				<ul class="results card">
					{#each hits as h (h.node.id)}
						<li>
							<button class="ghost" onclick={() => select(h.node.id)}>
								<span class="hit-head">
									<span class="dot" style:background={store.types[h.node.type_id]?.color}></span>
									<span class="hit-name">{h.node.name}</span>
									<span class="muted hit-why">{store.types[h.node.type_id]?.label ?? ''} · {h.why}</span>
								</span>
								{#if h.preview.length}
									<span class="hit-preview"
										>{#each h.preview as seg, i (i)}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}</span
									>
								{/if}
							</button>
						</li>
					{:else}
						<li class="muted">No matches</li>
					{/each}
				</ul>
			{/if}
		</div>
		<div class="filters">
			{#each store.sortedTypes as t (t.id)}
				<button
					class="tag"
					class:off={hiddenTypes.includes(t.id)}
					aria-pressed={!hiddenTypes.includes(t.id)}
					onclick={() => toggleType(t.id)}
					ondblclick={(e) => {
						// The double-click's two clicks toggled it twice, so it's as it was.
						openTypeEditor(e.currentTarget, t);
					}}
					oncontextmenu={(e) => {
						e.preventDefault();
						openTypeEditor(e.currentTarget, t);
					}}
					onkeydown={(e) => onTypeKey(e, t)}
					title={`${hiddenTypes.includes(t.id) ? 'Show' : 'Hide'} ${t.label} · double-click or right-click to rename`}
				>
					<span class="dot" style:background={t.color}></span>{t.label}
				</button>
			{/each}
			<button
				class="tag add-type"
				onclick={(e) => openTypeEditor(e.currentTarget, null)}
				aria-label="Add a node type"
				title="Add a node type">+</button
			>
			<label class="asof">
				As of session
				<input type="number" min="0" bind:value={asOfSession} placeholder="all" />
			</label>
		</div>
		<div class="actions">
			<button
				class="ghost reorganize"
				onclick={reorganize}
				disabled={reorganizing || visibleNodes.length < 2}
				aria-busy={reorganizing}
				title="Move the nodes into a tidier layout: fewer crossing lines, connected nodes close together, nothing overlapping"
			>
				{#if reorganizing}<span class="spinner" aria-hidden="true"></span>{/if}
				{reorganizing ? 'Reorganizing…' : 'Reorganize'}
			</button>
			<button onclick={newNode} aria-keyshortcuts={shortcutsOn ? 'N' : undefined} title={shortcutsOn ? 'Shortcut: N' : undefined}>+ New node</button>
		</div>
	</div>

	<div class="workspace">
		<div class="canvas" bind:this={canvasEl}>
			<Graph
				bind:this={graph}
				campaignId={store.id}
				nodes={visibleNodes}
				edges={visibleEdges}
				types={store.types}
				{selectedId}
				{highlight}
				onselect={(id) => select(id, false)}
				onbackground={clickBackground}
				onmenu={(at) => {
					quick = null;
					menu = at;
				}}
				onconnect={connect}
				onannotate={annotate}
			/>
			{#if store.liveNodes.length === 0}
				<p class="empty muted">
					Your graph is empty. Right-click anywhere here and choose <strong>New node here</strong>, or use
					<strong>+ New node</strong>, to add your first place, person, object or piece of lore.
				</p>
			{/if}
			{#if graphError}
				<p class="graph-error error">
					{graphError}
					<button class="ghost small" onclick={() => (graphError = null)} aria-label="Dismiss">✕</button>
				</p>
			{/if}

			<div class="stack" class:wide-open={campaignOpen} bind:this={stackEl}>
				{#if campaignOpen}
					<div class="layer base">
						<Panel title="Campaign" covered={Boolean(overlay)}>
							{#snippet actions()}
								<button
									class="ghost small"
									onclick={() => setCampaignOpen(false)}
									aria-label="Collapse campaign panel"
									title="Collapse">«</button
								>
							{/snippet}
							<p class="muted">
								{store.liveNodes.length} nodes · {store.liveEdges.length} connections ·
								{new Set(store.online.map((p) => p.user_id)).size} online
							</p>
							{#if toolError}<p class="error">{toolError}</p>{/if}

							<h3>Invite the party</h3>
							<button class="ghost" onclick={invite}>Create invite link</button>
							{#if inviteUrl}
								<p class="muted small-text">Copied to clipboard. Valid for 7 days:</p>
								<input class="invite" readonly value={inviteUrl} onfocus={(e) => e.currentTarget.select()} />
							{/if}

							<h3>Tags</h3>
							{#if store.allTags.length}
								<div class="tag-list">
									{#each store.allTags as t (t)}
										<button class="tag" onclick={() => (query = `#${t}`)}>#{t}</button>
									{/each}
								</div>
							{:else}
								<p class="muted">No tags yet.</p>
							{/if}

							<h3>Keyboard shortcuts</h3>
							<label class="toggle">
								<input type="checkbox" bind:checked={shortcutsOn} />
								Single-key shortcuts
							</label>
							{#if shortcutsOn}
								<dl class="shortcuts">
									{#each SHORTCUTS as s (s.action)}
										<dt><kbd>{s.keys}</kbd></dt>
										<dd>{s.label}</dd>
									{/each}
								</dl>
								<p class="muted small-text">They don't work while you're typing in a field.</p>
							{/if}

							<h3>Trash</h3>
							{#if store.trashedNodes.length}
								<ul class="trash">
									{#each store.trashedNodes as n (n.id)}
										<li>
											<span>{n.name}</span>
											<button class="ghost small" onclick={() => restoreNode(n.id)}>Restore</button>
										</li>
									{/each}
								</ul>
							{:else}
								<p class="muted">Empty.</p>
							{/if}
						</Panel>
					</div>
				{:else if !overlay}
					<button class="ghost panel-tab" onclick={() => setCampaignOpen(true)} aria-label="Open campaign panel">
						☰ Campaign
					</button>
				{/if}

				{#if overlay === 'create' && drafting}
					<div class="layer top" class:peek={campaignOpen} transition:slide>
						<Panel title="New node" onclose={() => (drafting = null)}>
							{#if createError}<p class="error">{createError}</p>{/if}
							<NodeForm
								bind:this={nodeForm}
								types={store.sortedTypes}
								initial={drafting.input}
								{saving}
								onsave={(input) => createNode(input, drafting?.place ?? null)}
								oncancel={() => (drafting = null)}
							/>
						</Panel>
					</div>
				{:else if overlay === 'node' && selectedId}
					<div class="layer top" class:peek={campaignOpen} transition:slide>
						<Panel label="Node" onclose={() => select(null)}>
							<NodePanel {store} nodeId={selectedId} onselect={select} ontag={(t) => (query = `#${t}`)} />
						</Panel>
					</div>
				{/if}
			</div>

			{#if menu}
				<Menu at={menu} label="Map" items={menuItems(menu)} onclose={() => (menu = null)} />
			{/if}
			{#if quick}
				<Popover at={quick.at} label="New node" onclose={() => (quick = null)}>
					<NodeQuickForm
						bind:this={quickForm}
						types={store.sortedTypes}
						{saving}
						error={createError}
						onsave={(input) => createNode(input, quick?.place ?? null)}
						onexpand={expandQuick}
					/>
				</Popover>
			{/if}
		</div>
	</div>
{/if}

{#if typeEditor && store}
	{#key typeEditor}
		<TypeEditor
			anchor={typeEditor.anchor}
			heading={typeEditor.type ? `Rename “${typeEditor.type.label}”` : 'New node type'}
			initial={typeEditor.type ? { label: typeEditor.type.label, color: typeEditor.type.color } : undefined}
			submitLabel={typeEditor.type ? 'Save' : 'Add'}
			saving={typeSaving}
			error={typeError}
			onsave={saveType}
			onclose={() => (typeEditor = null)}
		/>
	{/key}
{/if}

<svelte:window onkeydown={onWindowKey} />

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem 1rem;
		padding: 0.6rem 1rem;
		border-bottom: 1px solid var(--border);
	}
	h1 {
		font-size: 1.1rem;
		margin: 0;
	}
	.search {
		position: relative;
		flex: 1 1 16rem;
		max-width: 28rem;
	}
	.search input {
		width: 100%;
	}
	.results {
		position: absolute;
		z-index: 10;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		list-style: none;
		margin: 0;
		padding: 0.35rem;
		max-height: 60vh;
		overflow: auto;
	}
	.results button {
		width: 100%;
		text-align: left;
		border: none;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.15rem;
	}
	.hit-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
	}
	.hit-name {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hit-why {
		font-size: 0.75rem;
		margin-left: auto;
		flex: none;
	}
	.hit-preview {
		font-size: 0.8rem;
		color: var(--muted);
		padding-left: 1.05rem;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: anywhere;
	}
	.hit-preview mark {
		background: color-mix(in srgb, var(--accent) 30%, transparent);
		color: var(--text);
		border-radius: 2px;
		padding: 0 1px;
	}
	.results li.muted {
		padding: 0.4rem 0.6rem;
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}
	.filters .tag {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.filters .off {
		opacity: 0.4;
		text-decoration: line-through;
	}
	.dot {
		display: inline-block;
		width: 0.65rem;
		height: 0.65rem;
		border-radius: 50%;
		flex: none;
	}
	.asof {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.8rem;
		color: var(--muted);
	}
	.asof input {
		width: 4.5rem;
		padding: 0.2rem 0.4rem;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		margin-left: auto;
	}
	.reorganize {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
	}
	/* Disabled while it works, but it shouldn't look greyed out for that. */
	.reorganize[aria-busy='true'] {
		opacity: 1;
		cursor: progress;
	}
	.spinner {
		width: 0.9em;
		height: 0.9em;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		flex: none;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.workspace {
		flex: 1;
		display: flex;
		min-height: 0;
	}
	.canvas {
		flex: 1;
		position: relative;
		min-width: 0;
		overflow: hidden;
	}
	.empty {
		position: absolute;
		inset: 40% 1rem auto;
		text-align: center;
		pointer-events: none;
	}
	.graph-error {
		position: absolute;
		top: var(--gap-float);
		right: var(--gap-float);
		max-width: 24rem;
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--panel);
		padding: 0.4rem 0.6rem;
		border-radius: var(--radius);
		box-shadow: var(--shadow-float);
		z-index: 6;
	}

	/* Floating side panels, on the left. A panel opened from the map sits on
	   top of the Campaign panel like a page laid over another, leaving the
	   Campaign panel's right edge showing. */
	.stack {
		position: absolute;
		top: var(--gap-float);
		bottom: var(--gap-float);
		left: var(--gap-float);
		width: min(26rem, calc(100% - 2 * var(--gap-float)));
		pointer-events: none;
		z-index: 4;
	}
	.layer {
		position: absolute;
		inset: 0;
		pointer-events: auto;
	}
	.layer.top.peek {
		right: var(--page-peek);
	}
	.panel-tab {
		pointer-events: auto;
		background: var(--panel);
		border-radius: var(--radius);
		box-shadow: var(--shadow-float);
	}
	h3 {
		font-size: 0.9rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted);
		margin: 1.25rem 0 0.5rem;
	}
	.invite {
		width: 100%;
		font-size: 0.8rem;
	}
	.toggle {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.shortcuts {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.3rem 0.6rem;
		margin: 0.5rem 0;
		align-items: center;
	}
	.shortcuts dd {
		margin: 0;
	}
	kbd {
		font-family: var(--mono);
		font-size: 0.8rem;
		padding: 0.05rem 0.4rem;
		border: 1px solid var(--border);
		border-bottom-width: 2px;
		border-radius: 4px;
	}
	.small-text {
		font-size: 0.8rem;
		margin: 0.5rem 0 0.25rem;
	}
	.tag-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.filters .add-type {
		justify-content: center;
		min-width: 1.9rem;
		border-style: dashed;
		color: var(--muted);
	}
	.trash {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.trash li {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.problem {
		max-width: 30rem;
		margin: 3rem auto;
	}

	/* Phones: the panels float along the bottom of the map instead, and a
	   panel on top leaves the Campaign panel's top edge showing. */
	@media (max-width: 720px) {
		.canvas {
			min-height: 75dvh;
		}
		.stack {
			top: auto;
			right: var(--gap-float);
			width: auto;
			height: min(55dvh, calc(100% - 2 * var(--gap-float) - var(--page-peek)));
		}
		.stack:not(.wide-open) {
			height: min(55dvh, calc(100% - 2 * var(--gap-float)));
		}
		.layer.top.peek {
			left: 0;
			right: 0;
			top: var(--page-peek);
			bottom: calc(-1 * var(--page-peek));
		}
		.stack.wide-open {
			bottom: calc(var(--gap-float) + var(--page-peek));
		}
		.panel-tab {
			position: absolute;
			bottom: 0;
			left: 0;
		}
		.actions {
			margin-left: 0;
		}
	}
</style>
