<script lang="ts">
	import type { CampaignStore, NodeInput } from '#lib/campaign.svelte.ts';
	import { buildNameIndex, renderNotes } from '#lib/markdown.ts';
	import type { LoreEdge, Revision } from '#lib/types.ts';
	import NodeForm from './NodeForm.svelte';

	interface Props {
		store: CampaignStore;
		nodeId: string;
		onselect: (id: string | null) => void;
		ontag: (tag: string) => void;
	}

	let { store, nodeId, onselect, ontag }: Props = $props();

	const node = $derived(store.nodes[nodeId]);
	const type = $derived(node ? store.types[node.type_id] : undefined);
	const isEditing = $derived(store.editing === nodeId);
	const holder = $derived(isEditing ? null : store.lockHolder(nodeId));
	const nameIndex = $derived(buildNameIndex(store.liveNodes));
	const notesHtml = $derived(node ? renderNotes(node.notes, nameIndex) : '');
	const connections = $derived([
		...store.liveEdges.filter((e) => e.from_id === nodeId),
		...store.liveEdges.filter((e) => e.to_id === nodeId && e.from_id !== nodeId)
	]);

	let saving = $state(false);
	let error = $state<string | null>(null);
	let history = $state<Revision[] | null>(null);

	// Reset per-node UI when switching nodes; give up any lock we were holding.
	let lastId = '';
	$effect(() => {
		if (nodeId !== lastId) {
			if (lastId && store.editing === lastId) store.endEdit();
			lastId = nodeId;
			error = null;
			history = null;
		}
	});

	async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
		saving = true;
		error = null;
		try {
			return await fn();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			saving = false;
		}
	}

	async function startEdit() {
		if (!(await store.beginEdit(nodeId))) error = `${store.lockHolder(nodeId)?.name ?? 'Someone'} is editing this.`;
	}

	async function save(input: NodeInput) {
		const ok = await run(() => store.updateNode(node, input));
		if (ok) await store.endEdit();
	}

	async function remove() {
		if (!confirm(`Delete "${node.name}"? You can restore it from the trash.`)) return;
		if (await run(() => store.deleteNode(node))) onselect(null);
	}

	async function toggleHistory() {
		history = history ? null : ((await run(() => store.history(nodeId))) ?? null);
	}

	async function restore(rev: Revision) {
		if (!confirm(`Restore version ${rev.version}? This saves it as a new version.`)) return;
		if (await run(() => store.restoreRevision(node, rev))) history = (await store.history(nodeId)) ?? null;
	}

	// --- Connections ---
	// New connections are drawn on the map (Shift+click); here they're edited.
	let editingEdge = $state<string | null>(null);
	let editAnnotation = $state('');
	let editSession = $state<number | null>(null);

	function beginEdgeEdit(edge: LoreEdge) {
		editingEdge = edge.id;
		editAnnotation = edge.annotation;
		editSession = edge.session_number ?? null;
	}

	async function saveEdge(edge: LoreEdge) {
		const ok = await run(() =>
			store.updateEdge(edge, {
				annotation: editAnnotation.trim(),
				session_number: editSession ?? null
			})
		);
		if (ok) editingEdge = null;
	}

	async function removeEdge(edge: LoreEdge) {
		if (confirm('Remove this connection?')) await run(() => store.deleteEdge(edge));
	}

	// Intercept [[wiki link]] clicks rendered as #node:<id>.
	function onNotesClick(e: MouseEvent) {
		const a = (e.target as HTMLElement).closest('a');
		const href = a?.getAttribute('href');
		if (href?.startsWith('#node:')) {
			e.preventDefault();
			onselect(href.slice('#node:'.length));
		}
	}

	const when = (iso: string) => new Date(iso).toLocaleString();
</script>

{#snippet end(id: string)}
	{#if id === nodeId}
		<strong>{store.nodes[id]?.name}</strong>
	{:else}
		<button class="link" onclick={() => onselect(id)}>{store.nodes[id]?.name ?? 'Unknown'}</button>
	{/if}
{/snippet}

{#if !node}
	<p class="muted">This node no longer exists.</p>
{:else if isEditing}
	<h2>Editing</h2>
	{#if error}<p class="error">{error}</p>{/if}
	<NodeForm types={store.sortedTypes} initial={node} {saving} onsave={save} oncancel={() => store.endEdit()} />
{:else}
	<header>
		<span class="type" style:background={type?.color}>{type?.label ?? 'Unknown'}</span>
		<h2>{node.name}</h2>
		{#if node.aliases.length}<p class="aka">a.k.a. {node.aliases.join(', ')}</p>{/if}
	</header>

	{#if store.lostLockTo}
		<p class="error">{store.lostLockTo} started editing first, so your edit was closed.</p>
	{/if}
	{#if holder}<p class="lock">🔒 {holder.name} is editing this…</p>{/if}
	{#if error}<p class="error">{error}</p>{/if}

	<div class="toolbar">
		<button onclick={startEdit} disabled={Boolean(holder) || saving}>Edit</button>
		<button class="ghost" onclick={toggleHistory}>{history ? 'Hide history' : 'History'}</button>
		<button class="ghost danger" onclick={remove} disabled={Boolean(holder) || saving}>Delete</button>
	</div>

	<dl class="meta">
		{#if node.session_number !== null}<dt>First seen</dt><dd>Session {node.session_number}</dd>{/if}
		<dt>Updated</dt><dd>{when(node.updated_at)} by {store.nameOf(node.updated_by)}</dd>
	</dl>

	{#if node.tags.length}
		<div class="tags">
			{#each node.tags as tag (tag)}
				<button class="tag" onclick={() => ontag(tag)}>#{tag}</button>
			{/each}
		</div>
	{/if}

	{#if history}
		<section>
			<h3>History</h3>
			<ol class="history">
				{#each history as rev (rev.id)}
					<li>
						<span>v{rev.version} · {rev.op} · {store.nameOf(rev.changed_by)} · {when(rev.changed_at)}</span>
						{#if rev.version !== node.version}
							<button class="ghost small" onclick={() => restore(rev)} disabled={Boolean(holder) || saving}>Restore</button>
						{/if}
					</li>
				{/each}
			</ol>
		</section>
	{/if}

	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="notes" onclick={onNotesClick}>
		{#if node.notes.trim()}{@html notesHtml}{:else}<p class="muted">No notes yet.</p>{/if}
	</div>

	<section>
		<h3>Connections</h3>
		{#if !connections.length}
			<p class="muted">None yet. With this node selected, Shift+click another node on the map to connect them.</p>
		{/if}
		<ul class="edges">
			{#each connections as e (e.id)}
				<li>
					{#if editingEdge === e.id}
						<input bind:value={editAnnotation} placeholder="annotation" />
						<input class="num" type="number" min="0" bind:value={editSession} placeholder="sess." />
						<button class="small" onclick={() => saveEdge(e)} disabled={saving}>Save</button>
						<button class="ghost small" onclick={() => (editingEdge = null)}>Cancel</button>
					{:else}
						{@render end(e.from_id)}
						{#if e.annotation}<em>{e.annotation}</em>{:else}<span class="dir">→</span>{/if}
						{@render end(e.to_id)}
						{#if e.session_number !== null}<span class="muted">(s{e.session_number})</span>{/if}
						<span class="spacer"></span>
						<button class="ghost small" title="Edit" onclick={() => beginEdgeEdit(e)}>✎</button>
						<button class="ghost small" title="Remove" onclick={() => removeEdge(e)}>✕</button>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	header h2 {
		margin: 0.25rem 0 0;
	}
	.type {
		display: inline-block;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		font-size: 0.75rem;
		color: #fff;
	}
	.aka {
		margin: 0.25rem 0 0;
		color: var(--muted);
		font-style: italic;
	}
	.toolbar {
		display: flex;
		gap: 0.5rem;
		margin: 0.75rem 0;
	}
	.meta {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.15rem 0.75rem;
		font-size: 0.8rem;
		color: var(--muted);
		margin: 0 0 0.75rem;
	}
	.meta dd {
		margin: 0;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-bottom: 0.75rem;
	}
	.notes {
		line-height: 1.55;
		overflow-wrap: anywhere;
	}
	.notes :global(.missing-link) {
		color: var(--muted);
		border-bottom: 1px dashed var(--muted);
	}
	.notes :global(a) {
		color: var(--accent);
	}
	h3 {
		font-size: 0.9rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted);
		margin: 1.25rem 0 0.5rem;
	}
	.edges,
	.history {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.edges li,
	.history li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
		font-size: 0.9rem;
	}
	.history li {
		justify-content: space-between;
		font-size: 0.8rem;
	}
	.spacer {
		flex: 1;
	}
	.dir {
		color: var(--muted);
	}
	.num {
		width: 4.5rem;
	}
	.lock {
		color: var(--accent);
	}
</style>
