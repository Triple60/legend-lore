<script lang="ts">
	import type { CampaignStore } from '#lib/campaign.svelte.ts';
	import { splitList } from '#lib/lists.ts';
	import { buildNameIndex, renderNotes } from '#lib/markdown.ts';
	import type { LoreEdge, Revision } from '#lib/types.ts';
	import { autogrow } from '#lib/ui/autogrow.ts';
	import { debug, short } from '#lib/debug.svelte.ts';
	import { tick } from 'svelte';

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
			if (lastId && store.editing === lastId) store.endEdit('(switched to another node)');
			if (lastId) store.lostLockTo = null;
			lastId = nodeId;
			error = null;
			history = null;
			section = null;
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

	// --- Click-to-edit (like a Trello card) ---
	// Clicking the details or the notes opens just that part for editing, with
	// Save and Discard changes. Opening one takes the node's edit lock, so
	// only one person edits a node at a time; closing it gives the lock back.
	type Section = 'details' | 'notes';
	let section = $state<Section | null>(null);
	/**
	 * The open section. Esc on the page ends the edit and closes it. Losing the
	 * lock to someone else does not: the editor stays open with everything
	 * typed so far, and saving is still guarded by the version check.
	 */
	const open = $derived(isEditing || store.lostLockTo ? section : null);
	$effect(() => {
		if (section && !isEditing && !store.lostLockTo) {
			debug.log('editor closed', `${section}: the edit was ended elsewhere ${draftSize()}`);
			section = null;
		}
	});

	// --- Debug log (see debug.svelte.ts): never what's typed, only how much ---
	const draftSize = () => `(draft: ${section === 'notes' ? draftNotes.length : draftName.length} chars)`;
	$effect(() => {
		debug.log('node panel opened', short(nodeId));
		return () => debug.log('node panel closed', `${short(nodeId)}${section ? ` with ${section} editor open ${draftSize()}` : ''}`);
	});
	$effect(() => {
		if (!node) debug.log('node panel', `${short(nodeId)} is missing from the data`);
	});
	let lastTypingLog = 0;
	$effect(() => {
		const size = open === 'notes' ? draftNotes.length : open === 'details' ? draftName.length : -1;
		if (size < 0 || performance.now() - lastTypingLog < 2000) return;
		lastTypingLog = performance.now();
		debug.log('typing', `${open}: ${size} chars`);
	});

	/** The node's version when the open editor was opened. */
	let baseVersion = $state(0);
	/** Someone saved this node while it was open here. */
	const changedUnderneath = $derived(Boolean(open && node && node.version !== baseVersion));
	$effect(() => {
		if (changedUnderneath) debug.log('changed while editing', `v${baseVersion} → v${node.version} by ${short(node.updated_by)}`);
	});

	let draftName = $state('');
	let draftType = $state('');
	let draftSession = $state<number | null>(null);
	let draftAliases = $state('');
	let draftTags = $state('');
	let draftNotes = $state('');

	let nameInput = $state<HTMLInputElement | null>(null);
	let notesInput = $state<HTMLTextAreaElement | null>(null);

	async function openSection(which: Section) {
		if (open === which || saving) return;
		if (!isEditing && !store.beginEdit(nodeId)) {
			error = `${store.lockHolder(nodeId)?.name ?? 'Someone'} is editing this.`;
			return;
		}
		error = null;
		baseVersion = node.version;
		if (which === 'details') {
			draftName = node.name;
			draftType = node.type_id;
			draftSession = node.session_number;
			draftAliases = node.aliases.join(', ');
			draftTags = node.tags.join(', ');
		} else {
			draftNotes = node.notes;
		}
		section = which;
		debug.log('editor opened', which);
		await tick();
		if (which === 'details') nameInput?.focus();
		else {
			notesInput?.focus();
			notesInput?.setSelectionRange(draftNotes.length, draftNotes.length);
		}
	}

	async function discard(why = '(discarded)') {
		if (section) debug.log('editor closed', `${section} ${why} ${draftSize()}`);
		section = null;
		error = null;
		store.lostLockTo = null;
		store.endEdit(why);
	}

	async function saveSection() {
		if (open === 'details' && !draftName.trim()) return;
		const patch =
			open === 'details'
				? {
						name: draftName.trim(),
						type_id: draftType,
						session_number: draftSession ?? null,
						aliases: splitList(draftAliases),
						tags: splitList(draftTags)
					}
				: { notes: draftNotes };
		// Save against the version the editor opened with, so a change someone
		// else saved meanwhile is refused instead of silently overwritten.
		if (await run(() => store.updateNode({ ...node, version: baseVersion }, patch))) await discard('(saved)');
	}


	/** In an open editor: Esc discards, Ctrl/Cmd+Enter saves. */
	function onEditorKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			discard('(Esc in the editor)');
		} else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			saveSection();
		}
	}

	/** A click on a read-only section opens it, unless it was on a link or button inside. */
	function onSectionClick(e: MouseEvent, which: Section) {
		if ((e.target as HTMLElement).closest('a, button')) return;
		// Don't open the editor when the person was selecting text to copy.
		if (getSelection()?.toString()) return;
		openSection(which);
	}

	function onSectionKey(e: KeyboardEvent, which: Section) {
		if (e.target !== e.currentTarget) return;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			openSection(which);
		}
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

	// Intercept [[wiki link]] clicks rendered as #node:<id>; a click anywhere
	// else in the notes opens them for editing.
	function onNotesClick(e: MouseEvent) {
		const a = (e.target as HTMLElement).closest('a');
		const href = a?.getAttribute('href');
		if (href?.startsWith('#node:')) {
			e.preventDefault();
			onselect(href.slice('#node:'.length));
			return;
		}
		if (!locked) onSectionClick(e, 'notes');
	}

	const locked = $derived(Boolean(holder));

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
{:else}
	{#snippet lostLock()}
		<!-- Shown beside the open editor, so it's in view wherever the panel is scrolled. -->
		{#if store.lostLockTo}
			<p class="error" role="status">
				{store.lostLockTo} started editing this too. Your changes are still here: save them, or copy them
				somewhere safe. If the other edit is saved first, yours will be refused rather than overwrite it.
			</p>
		{/if}
		{#if changedUnderneath}
			<p class="error" role="status">
				{store.nameOf(node.updated_by)} saved a change to this node while you were editing, so saving here would
				overwrite it and will be refused. Your text is still here: copy it somewhere safe, then choose Discard
				changes to see the latest version.
			</p>
		{/if}
	{/snippet}
	{#if holder}<p class="lock">🔒 {holder.name} is editing this…</p>{/if}
	{#if error}<p class="error">{error}</p>{/if}

	{#if open === 'details'}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<form
			class="editor details-form"
			aria-label="Edit details"
			onsubmit={(e) => {
				e.preventDefault();
				saveSection();
			}}
			onkeydown={onEditorKey}
		>
			{@render lostLock()}
			<label>
				Name
				<input class="name-input" bind:this={nameInput} bind:value={draftName} required maxlength="200" />
			</label>
			<div class="row">
				<label>
					Type
					<select bind:value={draftType} required>
						{#each store.sortedTypes as t (t.id)}
							<option value={t.id}>{t.label}</option>
						{/each}
					</select>
				</label>
				<label class="session">
					First seen <input type="number" min="0" step="1" bind:value={draftSession} placeholder="session" />
				</label>
			</div>
			<label>
				Also known as <span class="hint">comma-separated</span>
				<input bind:value={draftAliases} placeholder="The Devil, The Ancient" />
			</label>
			<label>
				Tags <span class="hint">comma-separated</span>
				<input bind:value={draftTags} placeholder="vampire, barovia, villain" />
			</label>
			<div class="editor-actions">
				<button type="submit" disabled={saving || !draftName.trim()}>{saving ? 'Saving…' : 'Save'}</button>
				<button type="button" class="ghost" onclick={() => discard('(Discard changes button)')} disabled={saving}>Discard changes</button>
			</div>
		</form>
	{:else}
		<!-- Focusable so the keyboard can open it too (Enter); it holds tag buttons, so it can't itself be a button. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
		<div
			class="editable"
			role="group"
			class:locked
			tabindex={locked ? -1 : 0}
			aria-label={locked ? undefined : 'Edit details'}
			title={locked ? undefined : 'Click to edit'}
			onclick={(e) => !locked && onSectionClick(e, 'details')}
			onkeydown={(e) => !locked && onSectionKey(e, 'details')}
		>
			<header>
				<span class="type" style:background={type?.color}>{type?.label ?? 'Unknown'}</span>
				<h2>{node.name}</h2>
				{#if node.aliases.length}<p class="aka">a.k.a. {node.aliases.join(', ')}</p>{/if}
			</header>
			{#if node.session_number !== null}<p class="seen">First seen in session {node.session_number}</p>{/if}
			{#if node.tags.length}
				<div class="tags">
					{#each node.tags as tag (tag)}
						<button class="tag" onclick={() => ontag(tag)}>#{tag}</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<p class="meta">Updated {when(node.updated_at)} by {store.nameOf(node.updated_by)}</p>

	<div class="toolbar">
		<button class="ghost" onclick={toggleHistory}>{history ? 'Hide history' : 'History'}</button>
		<button class="ghost danger" onclick={remove} disabled={locked || saving}>Delete</button>
	</div>

	{#if history}
		<section>
			<h3>History</h3>
			<ol class="history">
				{#each history as rev (rev.id)}
					<li>
						<span>v{rev.version} · {rev.op} · {store.nameOf(rev.changed_by)} · {when(rev.changed_at)}</span>
						{#if rev.version !== node.version}
							<button class="ghost small" onclick={() => restore(rev)} disabled={locked || saving}>Restore</button>
						{/if}
					</li>
				{/each}
			</ol>
		</section>
	{/if}

	<section>
		<h3>Notes</h3>
		{#if open === 'notes'}
			<div class="editor">
				{@render lostLock()}
				<textarea
					class="notes-input"
					bind:this={notesInput}
					bind:value={draftNotes}
					use:autogrow
					rows="4"
					aria-label="Notes"
					placeholder="Markdown; link nodes with [[Name]]"
					onkeydown={onEditorKey}
				></textarea>
				<div class="editor-actions">
					<button onclick={saveSection} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
					<button class="ghost" onclick={() => discard('(Discard changes button)')} disabled={saving}>Discard changes</button>
				</div>
			</div>
		{:else}
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
			<div
				class="notes editable"
				role="group"
				class:locked
				class:empty={!node.notes.trim()}
				tabindex={locked ? -1 : 0}
				aria-label={locked ? undefined : 'Edit notes'}
				title={locked ? undefined : 'Click to edit'}
				onclick={onNotesClick}
				onkeydown={(e) => !locked && onSectionKey(e, 'notes')}
			>
				{#if node.notes.trim()}{@html notesHtml}{:else}<p class="muted">Add notes…</p>{/if}
			</div>
		{/if}
	</section>

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
		font-size: 0.8rem;
		color: var(--muted);
		margin: 0.5rem 0 0;
	}
	.seen {
		margin: 0.35rem 0 0;
		font-size: 0.85rem;
		color: var(--muted);
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.5rem;
	}

	/* Read-only sections that open for editing when clicked. */
	.editable {
		margin: 0 -0.5rem;
		padding: 0.4rem 0.5rem;
		border-radius: var(--radius-sm);
		cursor: text;
		transition: background-color var(--dur) var(--ease);
	}
	.editable:not(.locked):hover {
		background: var(--hover);
	}
	.editable:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.editable.locked {
		cursor: default;
	}
	.notes.empty {
		background: var(--hover);
		min-height: 3.5rem;
	}
	.notes.empty p {
		margin: 0.3rem 0;
	}
	.editor {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.editor label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.85rem;
		color: var(--muted);
	}
	.editor .row {
		display: flex;
		gap: 0.75rem;
	}
	.editor .row label {
		flex: 1;
		min-width: 0;
	}
	.editor .session {
		flex: 0 0 6.5rem;
	}
	.hint {
		font-size: 0.75rem;
		opacity: 0.8;
	}
	.name-input {
		font-size: 1.15rem;
		font-weight: 600;
	}
	.notes-input {
		font-family: var(--mono);
		line-height: 1.45;
		resize: none;
		min-height: 6rem;
	}
	.editor-actions {
		display: flex;
		gap: 0.5rem;
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
