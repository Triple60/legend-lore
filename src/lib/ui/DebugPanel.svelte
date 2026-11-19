<!--
	The debug log's panel (see debug.svelte.ts), shown only while the log is
	on. Collapsed it's a small button; open, it lists the events, newest at the
	bottom, with a button to copy them all.
-->
<script lang="ts">
	import { debug } from '#lib/debug.svelte.ts';
	import { tick } from 'svelte';

	let open = $state(true);
	let copied = $state<'yes' | 'failed' | null>(null);
	let list = $state<HTMLOListElement | null>(null);
	let fallback = $state<HTMLTextAreaElement | null>(null);
	let showText = $state(false);

	// Keep the newest events in view as they arrive.
	$effect(() => {
		void debug.entries.length;
		if (list) list.scrollTop = list.scrollHeight;
	});

	async function copy() {
		try {
			await navigator.clipboard.writeText(debug.text());
			copied = 'yes';
		} catch {
			// No clipboard access (some phones): show the text to copy by hand.
			copied = 'failed';
			showText = true;
			await tick();
			fallback?.select();
		}
		setTimeout(() => (copied = null), 2000);
	}
</script>

{#if debug.enabled}
	<section class="debug" class:open aria-label="Debug log">
		<header>
			<button class="ghost small" onclick={() => (open = !open)} aria-expanded={open}>
				🐞 Debug log ({debug.entries.length})
			</button>
			{#if open}
				<span class="spacer"></span>
				<button class="ghost small" onclick={copy}>{copied === 'yes' ? 'Copied' : 'Copy all'}</button>
				<button class="ghost small" onclick={() => debug.clear()}>Clear</button>
			{/if}
		</header>
		{#if open}
			{#if showText}
				<textarea bind:this={fallback} readonly value={debug.text()} aria-label="Debug log text"></textarea>
				<button class="ghost small" onclick={() => (showText = false)}>Back to the list</button>
			{:else}
				<ol bind:this={list}>
					{#each debug.entries as e, i (i)}
						<li><span class="t">{e.t.toFixed(1)}</span> <strong>{e.event}</strong> {e.detail}</li>
					{/each}
				</ol>
			{/if}
			<p class="hint">Turn off by adding <code>?debug=off</code> to the address.</p>
		{/if}
	</section>
{/if}

<style>
	.debug {
		position: fixed;
		right: 0.5rem;
		bottom: 0.5rem;
		z-index: 1000;
		max-width: min(34rem, calc(100vw - 1rem));
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-float);
		font-size: 0.75rem;
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem;
	}
	.spacer {
		flex: 1;
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0.25rem 0.5rem;
		max-height: 14rem;
		overflow: auto;
		font-family: var(--mono);
		overflow-wrap: anywhere;
		border-top: 1px solid var(--border);
	}
	li {
		padding: 0.1rem 0;
	}
	.t {
		color: var(--muted);
	}
	textarea {
		display: block;
		width: calc(100% - 1rem);
		height: 14rem;
		margin: 0.25rem 0.5rem;
		font-family: var(--mono);
		font-size: 0.7rem;
	}
	.hint {
		margin: 0;
		padding: 0.25rem 0.5rem 0.4rem;
		color: var(--muted);
	}
</style>
