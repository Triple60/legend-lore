<!--
	A floating side panel. `covered` dims it and makes it inert while another
	panel sits on top of it. Position it with a wrapper; it fills its parent.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title?: string;
		/** Accessible name when there's no visible title. */
		label?: string;
		covered?: boolean;
		/** Buttons for the header, before the close button. */
		actions?: Snippet;
		onclose?: () => void;
		closeLabel?: string;
		children: Snippet;
	}

	let { title, label, covered = false, actions, onclose, closeLabel = 'Close panel', children }: Props = $props();
</script>

<section class="panel" class:covered inert={covered} aria-label={label ?? title}>
	{#if title || actions || onclose}
		<header>
			{#if title}<h2>{title}</h2>{/if}
			<span class="spacer"></span>
			{@render actions?.()}
			{#if onclose}
				<button class="ghost small" onclick={onclose} aria-label={closeLabel} title={closeLabel}>✕</button>
			{/if}
		</header>
	{/if}
	<div class="body">{@render children()}</div>
</section>

<style>
	.panel {
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-float);
		overflow: hidden;
	}
	.covered::after {
		content: '';
		position: absolute;
		inset: 0;
		background: var(--scrim);
		pointer-events: none;
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.75rem 0.75rem 0 1rem;
	}
	h2 {
		margin: 0;
		font-size: 1.15rem;
	}
	.spacer {
		flex: 1;
	}
	.body {
		flex: 1;
		overflow-y: auto;
		padding: 0.5rem 1rem 1rem;
	}
</style>
