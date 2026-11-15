<!--
	A context menu, opened at a point inside its positioned parent. It is placed
	so the first item sits right under that point: right-click, then left-click
	without moving, picks it.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { clampInto, type Point } from './place.ts';

	export interface MenuItem {
		label: string;
		/** Right-aligned hint, e.g. a keyboard shortcut. */
		hint?: string;
		onselect: () => void;
	}

	interface Props {
		at: Point;
		items: MenuItem[];
		label: string;
		onclose: () => void;
	}

	let { at, items, label, onclose }: Props = $props();

	let menu: HTMLDivElement;
	let pos = $state<Point | null>(null);

	onMount(() => {
		const first = menu.querySelector<HTMLButtonElement>('[role="menuitem"]');
		// Put the pointer a little inside the first item, vertically centred.
		const target = first
			? { x: at.x - 16, y: at.y - first.offsetTop - first.offsetHeight / 2 }
			: at;
		const parent = menu.offsetParent as HTMLElement | null;
		pos = parent
			? clampInto(target, { width: menu.offsetWidth, height: menu.offsetHeight }, { width: parent.clientWidth, height: parent.clientHeight })
			: target;
		first?.focus();
	});

	function pick(item: MenuItem) {
		onclose();
		item.onselect();
	}

	function buttons() {
		return [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
	}

	function onkeydown(e: KeyboardEvent) {
		const all = buttons();
		const i = all.indexOf(document.activeElement as HTMLButtonElement);
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			const step = e.key === 'ArrowDown' ? 1 : -1;
			all[(i + step + all.length) % all.length]?.focus();
		} else if (e.key === 'Home' || e.key === 'End') {
			e.preventDefault();
			all[e.key === 'Home' ? 0 : all.length - 1]?.focus();
		} else if (e.key === 'Escape' || e.key === 'Tab') {
			e.preventDefault();
			onclose();
		}
	}

	// Any press outside closes it.
	function onWindowPointer(e: PointerEvent) {
		if (!menu.contains(e.target as Node)) onclose();
	}
</script>

<svelte:window onpointerdowncapture={onWindowPointer} onblur={onclose} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="menu"
	role="menu"
	tabindex="-1"
	aria-label={label}
	bind:this={menu}
	style:left="{pos?.x ?? at.x}px"
	style:top="{pos?.y ?? at.y}px"
	style:opacity={pos ? 1 : 0}
	{onkeydown}
	oncontextmenu={(e) => e.preventDefault()}
>
	{#each items as item (item.label)}
		<button type="button" role="menuitem" onclick={() => pick(item)}>
			<span>{item.label}</span>
			{#if item.hint}<kbd>{item.hint}</kbd>{/if}
		</button>
	{/each}
</div>

<style>
	.menu {
		position: absolute;
		z-index: 20;
		min-width: 12rem;
		padding: 0.3rem;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-float);
	}
	button {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		background: none;
		color: var(--text);
		border: none;
		border-radius: var(--radius-sm);
		padding: 0.45rem 0.7rem;
		text-align: left;
		font-weight: 500;
	}
	button:hover,
	button:focus-visible {
		background: var(--hover);
		outline: none;
	}
	button:first-child {
		color: var(--accent);
		font-weight: 600;
	}
	kbd {
		font-family: var(--mono);
		font-size: 0.75rem;
		color: var(--muted);
	}
</style>
