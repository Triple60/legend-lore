<!--
	The quick-add popover's form: a name, type, tags and an optional
	description (the node's notes) that grows as you type. "Open in side panel"
	hands what's typed so far to the full form.
-->
<script lang="ts">
	import type { NodeInput } from '#lib/campaign.svelte.ts';
	import { splitList } from '#lib/lists.ts';
	import type { NodeType } from '#lib/types.ts';
	import { autogrow } from '#lib/ui/autogrow.ts';
	import { onMount, untrack } from 'svelte';

	interface Props {
		types: NodeType[];
		saving?: boolean;
		error?: string | null;
		onsave: (input: NodeInput) => void;
		onexpand: (draft: Partial<NodeInput>) => void;
	}

	let { types, saving = false, error = null, onsave, onexpand }: Props = $props();

	let name = $state('');
	let typeId = $state(untrack(() => types[0]?.id ?? ''));
	let tags = $state('');
	let notes = $state('');

	let nameInput: HTMLInputElement;
	export function focusName() {
		nameInput.focus();
	}
	onMount(focusName);

	const draft = (): NodeInput => ({
		name: name.trim(),
		type_id: typeId,
		aliases: [],
		tags: splitList(tags),
		notes,
		session_number: null
	});

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (name.trim()) onsave(draft());
	}

	// In the description, Enter makes a new line; Ctrl/Cmd+Enter saves.
	function onNotesKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			if (name.trim()) onsave(draft());
		}
	}
</script>

<form class="quick" onsubmit={submit}>
	<input
		class="name"
		bind:this={nameInput}
		bind:value={name}
		required
		maxlength="200"
		placeholder="Add a name"
		aria-label="Name"
	/>
	<div class="types" role="radiogroup" aria-label="Type">
		{#each types as t (t.id)}
			<label class="type" class:on={typeId === t.id} style:--dot={t.color}>
				<input type="radio" name="quick-type" value={t.id} bind:group={typeId} />
				<span class="dot"></span>{t.label}
			</label>
		{/each}
	</div>
	<input bind:value={tags} placeholder="Tags, comma-separated" aria-label="Tags" />
	<textarea
		class="notes"
		bind:value={notes}
		use:autogrow={12}
		rows="2"
		placeholder="Add a description (Markdown; [[Name]] links a node)"
		aria-label="Description"
		onkeydown={onNotesKey}
	></textarea>
	{#if error}<p class="error">{error}</p>{/if}
	<div class="actions">
		<button type="button" class="ghost" onclick={() => onexpand(draft())}>Open in side panel</button>
		<button type="submit" disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Save'}</button>
	</div>
</form>

<style>
	.quick {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}
	.name {
		font-size: 1.1rem;
		border-width: 0 0 2px;
		border-radius: 0;
		background: transparent;
		padding: 0.3rem 0.1rem;
	}
	.name:focus {
		outline: none;
		border-color: var(--accent);
	}
	.types {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.type {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.15rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.type.on {
		border-color: var(--dot);
		background: color-mix(in srgb, var(--dot) 18%, transparent);
	}
	.type:has(input:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.type input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.dot {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		background: var(--dot);
	}
	.notes {
		resize: none;
		line-height: 1.45;
		min-height: 2.6rem;
	}
	.error {
		margin: 0;
		font-size: 0.85rem;
	}
	.actions {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
	}
</style>
