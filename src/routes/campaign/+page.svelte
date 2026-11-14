<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { CampaignStore, type NodeInput } from '#lib/campaign.svelte.ts';
	import Graph from '#lib/components/Graph.svelte';
	import NodeForm from '#lib/components/NodeForm.svelte';
	import NodePanel from '#lib/components/NodePanel.svelte';
	import { searchNodes } from '#lib/search.ts';
	import { auth } from '#lib/session.svelte.ts';
	import { untrack } from 'svelte';

	const campaignId = $derived(page.url.searchParams.get('id') ?? '');

	let store = $state<CampaignStore | null>(null);
	let graph = $state<ReturnType<typeof Graph> | null>(null);

	// Depend on the user id only: token refreshes replace the session object
	// but shouldn't tear down and reload the whole campaign.
	const userId = $derived(auth.user?.id ?? null);

	$effect(() => {
		if (!userId) {
			const here = `${resolve('/campaign')}?id=${encodeURIComponent(campaignId)}`;
			goto(`${resolve('/login')}?next=${encodeURIComponent(here)}`, { replaceState: true });
			return;
		}
		const meta = untrack(() => auth.user);
		const name = meta?.user_metadata?.full_name ?? meta?.user_metadata?.name ?? meta?.email ?? 'Adventurer';
		const s = new CampaignStore(campaignId, { id: userId, name });
		store = s;
		s.load();
		return () => s.destroy();
	});

	// --- View state ---
	let selectedId = $state<string | null>(null);
	let creating = $state(false);
	let query = $state('');
	let hiddenTypes = $state<string[]>([]);
	let asOfSession = $state('');
	let saving = $state(false);
	let createError = $state<string | null>(null);

	const sessionCap = $derived(asOfSession.trim() === '' ? null : Number(asOfSession));
	const visibleNodes = $derived(
		(store?.liveNodes ?? []).filter(
			(n) =>
				!hiddenTypes.includes(n.type_id) &&
				(sessionCap === null || n.session_number === null || n.session_number <= sessionCap)
		)
	);
	const visibleIds = $derived(new Set(visibleNodes.map((n) => n.id)));
	const visibleEdges = $derived(
		(store?.liveEdges ?? []).filter(
			(e) =>
				visibleIds.has(e.from_id) &&
				visibleIds.has(e.to_id) &&
				(sessionCap === null || e.session_number === null || e.session_number <= sessionCap)
		)
	);
	const hits = $derived(searchNodes(visibleNodes, query));
	const highlight = $derived.by(() => {
		if (!query.trim()) return null;
		const ids = new Set(hits.map((h) => h.node.id));
		if (selectedId) ids.add(selectedId);
		return ids;
	});

	function select(id: string | null) {
		selectedId = id;
		creating = false;
		if (id) graph?.focus(id);
	}

	function toggleType(id: string) {
		hiddenTypes = hiddenTypes.includes(id) ? hiddenTypes.filter((t) => t !== id) : [...hiddenTypes, id];
	}

	function onSearchKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && hits[0]) select(hits[0].node.id);
		if (e.key === 'Escape') query = '';
	}

	async function createNode(input: NodeInput) {
		if (!store) return;
		saving = true;
		createError = null;
		try {
			const n = await store.createNode(input);
			creating = false;
			select(n.id);
		} catch (e) {
			createError = (e as Error).message;
		} finally {
			saving = false;
		}
	}

	// --- Sidebar tools (shown when nothing is selected) ---
	let inviteUrl = $state<string | null>(null);
	let toolError = $state<string | null>(null);
	let newTypeLabel = $state('');
	let newTypeColor = $state('#59a14f');

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

	async function addType(e: SubmitEvent) {
		e.preventDefault();
		toolError = null;
		try {
			await store!.createType(newTypeLabel.trim(), newTypeColor);
			newTypeLabel = '';
		} catch (err) {
			toolError = (err as Error).message;
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
				bind:value={query}
				onkeydown={onSearchKey}
				placeholder="Search names, aliases, notes, #tags…"
				aria-label="Search"
			/>
			{#if query.trim()}
				<ul class="results card">
					{#each hits as h (h.node.id)}
						<li>
							<button class="ghost" onclick={() => select(h.node.id)}>
								<span class="dot" style:background={store.types[h.node.type_id]?.color}></span>
								{h.node.name}
								<span class="muted">· {h.why}</span>
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
					onclick={() => toggleType(t.id)}
					title={hiddenTypes.includes(t.id) ? `Show ${t.label}` : `Hide ${t.label}`}
				>
					<span class="dot" style:background={t.color}></span>{t.label}
				</button>
			{/each}
			<label class="asof">
				As of session
				<input type="number" min="0" bind:value={asOfSession} placeholder="all" />
			</label>
		</div>
		<div class="actions">
			<button class="ghost" onclick={() => graph?.relayout()} title="Re-run automatic layout">Re-layout</button>
			<button onclick={() => ((creating = true), (selectedId = null))}>+ New node</button>
		</div>
	</div>

	<div class="workspace">
		<div class="canvas">
			<Graph
				bind:this={graph}
				campaignId={store.id}
				nodes={visibleNodes}
				edges={visibleEdges}
				types={store.types}
				{selectedId}
				{highlight}
				onselect={select}
			/>
			{#if store.liveNodes.length === 0}
				<p class="empty muted">Your graph is empty. Click <strong>+ New node</strong> to add your first place, person, object or piece of lore.</p>
			{/if}
		</div>

		<aside class="panel">
			{#if creating}
				<h2>New node</h2>
				{#if createError}<p class="error">{createError}</p>{/if}
				<NodeForm types={store.sortedTypes} {saving} onsave={createNode} oncancel={() => (creating = false)} />
			{:else if selectedId}
				<button class="ghost small close" onclick={() => select(null)}>✕ Close</button>
				<NodePanel {store} nodeId={selectedId} onselect={select} ontag={(t) => (query = `#${t}`)} />
			{:else}
				<h2>Campaign</h2>
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

				<h3>Node types</h3>
				<form class="add-type" onsubmit={addType}>
					<input type="color" bind:value={newTypeColor} aria-label="Colour" />
					<input bind:value={newTypeLabel} placeholder="e.g. Faction" required maxlength="50" />
					<button type="submit">Add</button>
				</form>

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
			{/if}
		</aside>
	</div>
{/if}

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
		align-items: center;
		gap: 0.4rem;
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
	.workspace {
		flex: 1;
		display: flex;
		min-height: 0;
	}
	.canvas {
		flex: 1;
		position: relative;
		min-width: 0;
	}
	.empty {
		position: absolute;
		inset: 40% 1rem auto;
		text-align: center;
		pointer-events: none;
	}
	.panel {
		width: min(28rem, 40vw);
		border-left: 1px solid var(--border);
		background: var(--panel);
		padding: 1rem;
		overflow-y: auto;
		max-height: calc(100dvh - 8rem);
	}
	.panel h2 {
		margin-top: 0;
	}
	.panel h3 {
		font-size: 0.9rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted);
		margin: 1.25rem 0 0.5rem;
	}
	.close {
		float: right;
	}
	.invite {
		width: 100%;
		font-size: 0.8rem;
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
	.add-type {
		display: flex;
		gap: 0.4rem;
	}
	.add-type input[type='color'] {
		width: 2.5rem;
		padding: 0.1rem;
	}
	.add-type input:not([type='color']) {
		flex: 1;
		min-width: 0;
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

	/* Phones: graph on top, panel below. */
	@media (max-width: 720px) {
		.workspace {
			flex-direction: column;
		}
		.canvas {
			height: 55dvh;
			flex: none;
		}
		.panel {
			width: 100%;
			max-height: none;
			border-left: none;
			border-top: 1px solid var(--border);
		}
		.actions {
			margin-left: 0;
		}
	}
</style>
