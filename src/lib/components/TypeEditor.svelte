<!--
	A small card under a toolbar button for adding a node type, or renaming
	and recolouring one. Esc or a press outside closes it.
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';

	interface Props {
		/** The button it opens from; the card sits just below it. */
		anchor: HTMLElement;
		heading: string;
		initial?: { label: string; color: string };
		submitLabel?: string;
		saving?: boolean;
		error?: string | null;
		onsave: (label: string, color: string) => void;
		onclose: () => void;
	}

	let {
		anchor,
		heading,
		initial = { label: '', color: '#59a14f' },
		submitLabel = 'Save',
		saving = false,
		error = null,
		onsave,
		onclose
	}: Props = $props();

	let label = $state(untrack(() => initial.label));
	let color = $state(untrack(() => initial.color));
	let card: HTMLDivElement;
	let input: HTMLInputElement;
	let pos = $state<{ left: number; top: number } | null>(null);

	onMount(() => {
		const a = anchor.getBoundingClientRect();
		const width = card.offsetWidth;
		const left = Math.max(8, Math.min(a.left, innerWidth - width - 8));
		pos = { left, top: a.bottom + 6 };
		input.focus();
		input.select();
	});

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (label.trim()) onsave(label.trim(), color);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			onclose();
		}
	}

	function onWindowPointer(e: PointerEvent) {
		const t = e.target as Node;
		if (!card.contains(t) && !anchor.contains(t)) onclose();
	}
</script>

<svelte:window onpointerdowncapture={onWindowPointer} />

<div
	class="type-editor"
	role="dialog"
	aria-label={heading}
	tabindex="-1"
	bind:this={card}
	style:left="{pos?.left ?? 0}px"
	style:top="{pos?.top ?? 0}px"
	style:opacity={pos ? 1 : 0}
	{onkeydown}
>
	<form onsubmit={submit}>
		<h3>{heading}</h3>
		<div class="fields">
			<input type="color" bind:value={color} aria-label="Colour" />
			<input bind:this={input} bind:value={label} placeholder="e.g. Faction" required maxlength="50" aria-label="Name" />
		</div>
		{#if error}<p class="error">{error}</p>{/if}
		<div class="actions">
			<button type="button" class="ghost" onclick={onclose}>Cancel</button>
			<button type="submit" disabled={saving || !label.trim()}>{saving ? 'Saving…' : submitLabel}</button>
		</div>
	</form>
</div>

<style>
	.type-editor {
		position: fixed;
		z-index: 30;
		width: min(18rem, calc(100vw - 16px));
		padding: 0.75rem 0.85rem;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-float);
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	h3 {
		margin: 0;
		font-size: 0.85rem;
		color: var(--muted);
		font-weight: 600;
	}
	.fields {
		display: flex;
		gap: 0.4rem;
	}
	input[type='color'] {
		width: 2.5rem;
		padding: 0.1rem;
		flex: none;
	}
	.fields input:not([type='color']) {
		flex: 1;
		min-width: 0;
	}
	.error {
		margin: 0;
		font-size: 0.85rem;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
</style>
