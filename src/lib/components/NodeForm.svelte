<script lang="ts">
	import type { NodeInput } from '#lib/campaign.svelte.ts';
	import type { LoreNode, NodeType } from '#lib/types.ts';
	import { untrack } from 'svelte';

	interface Props {
		types: NodeType[];
		initial?: LoreNode | null;
		saving?: boolean;
		onsave: (input: NodeInput) => void;
		oncancel: () => void;
	}

	let { types, initial = null, saving = false, onsave, oncancel }: Props = $props();

	const splitList = (s: string) =>
		s
			.split(',')
			.map((x) => x.trim())
			.filter(Boolean);

	// Form fields are seeded once from `initial`; later realtime updates to the
	// same node are blocked by the edit lock, so there's nothing to re-sync.
	const seed = untrack(() => initial);
	const defaultType = untrack(() => types[0]?.id ?? '');
	let name = $state(seed?.name ?? '');
	let typeId = $state(seed?.type_id ?? defaultType);
	let aliases = $state(seed?.aliases.join(', ') ?? '');
	let tags = $state(seed?.tags.join(', ') ?? '');
	let session = $state(seed?.session_number?.toString() ?? '');
	let notes = $state(seed?.notes ?? '');

	function submit(e: SubmitEvent) {
		e.preventDefault();
		onsave({
			name: name.trim(),
			type_id: typeId,
			aliases: splitList(aliases),
			tags: splitList(tags),
			notes,
			session_number: session.trim() === '' ? null : Number(session)
		});
	}
</script>

<form class="node-form" onsubmit={submit}>
	<label>
		Name
		<input bind:value={name} required maxlength="200" placeholder="e.g. Strahd von Zarovich" />
	</label>
	<div class="row">
		<label>
			Type
			<select bind:value={typeId} required>
				{#each types as t (t.id)}
					<option value={t.id}>{t.label}</option>
				{/each}
			</select>
		</label>
		<label class="session">
			Session
			<input type="number" min="0" step="1" bind:value={session} placeholder="—" />
		</label>
	</div>
	<label>
		Also known as <span class="hint">comma-separated</span>
		<input bind:value={aliases} placeholder="The Devil, The Ancient" />
	</label>
	<label>
		Tags <span class="hint">comma-separated</span>
		<input bind:value={tags} placeholder="vampire, barovia, villain" />
	</label>
	<label>
		Notes <span class="hint">Markdown; link nodes with [[Name]]</span>
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
