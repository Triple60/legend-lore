<script lang="ts">
	import type { NodeInput } from '#lib/campaign.svelte.ts';
	import { splitList } from '#lib/lists.ts';
	import type { NodeType } from '#lib/types.ts';
	import { onMount, untrack } from 'svelte';

	interface Props {
		types: NodeType[];
		/** An existing node to edit, or a draft (e.g. from the quick-add popover). */
		initial?: Partial<NodeInput> | null;
		saving?: boolean;
		onsave: (input: NodeInput) => void;
		oncancel: () => void;
	}

	let { types, initial = null, saving = false, onsave, oncancel }: Props = $props();

	// Form fields are seeded once from `initial`; later realtime updates to the
	// same node are blocked by the edit lock, so there's nothing to re-sync.
	const seed = untrack(() => initial);
	const defaultType = untrack(() => types[0]?.id ?? '');
	let name = $state(seed?.name ?? '');
	let typeId = $state(seed?.type_id || defaultType);
	let aliases = $state(seed?.aliases?.join(', ') ?? '');
	let tags = $state(seed?.tags?.join(', ') ?? '');
	let session = $state<number | null>(seed?.session_number ?? null);
	let notes = $state(seed?.notes ?? '');

	let nameInput: HTMLInputElement;
	export function focusName() {
		nameInput.focus();
	}
	onMount(focusName);

	function submit(e: SubmitEvent) {
		e.preventDefault();
		onsave({
			name: name.trim(),
			type_id: typeId,
			aliases: splitList(aliases),
			tags: splitList(tags),
			notes,
			session_number: session ?? null
		});
	}
</script>

<form class="node-form" onsubmit={submit}>
	<label>
		Name <span class="hint req">required</span>
		<input bind:this={nameInput} bind:value={name} required maxlength="200" placeholder="e.g. Strahd von Zarovich" />
	</label>
	<div class="row">
		<label>
			Type <span class="hint req">required</span>
			<select bind:value={typeId} required>
				{#each types as t (t.id)}
					<option value={t.id}>{t.label}</option>
				{/each}
			</select>
		</label>
		<label class="session">
			Session <span class="hint">optional</span>
			<input type="number" min="0" step="1" bind:value={session} placeholder="—" />
		</label>
	</div>
	<label>
		Also known as <span class="hint">optional · comma-separated</span>
		<input bind:value={aliases} placeholder="The Devil, The Ancient" />
	</label>
	<label>
		Tags <span class="hint">optional · comma-separated</span>
		<input bind:value={tags} placeholder="vampire, barovia, villain" />
	</label>
	<label>
		Notes <span class="hint">optional · Markdown; link nodes with [[Name]]</span>
		<textarea bind:value={notes} rows="12"></textarea>
	</label>
	<div class="actions">
		<button type="button" class="ghost" onclick={oncancel} disabled={saving}>Cancel</button>
		<button type="submit" disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Save'}</button>
	</div>
</form>

<style>
	.node-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.85rem;
		color: var(--muted);
	}
	.row {
		display: flex;
		gap: 0.75rem;
	}
	.row label {
		flex: 1;
	}
	.row .session {
		flex: 0 0 6rem;
	}
	.hint {
		font-size: 0.75rem;
		opacity: 0.8;
	}
	.req {
		color: var(--accent);
		opacity: 1;
	}
	textarea {
		font-family: var(--mono);
		resize: vertical;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
</style>
