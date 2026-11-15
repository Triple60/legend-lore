<!--
	A small floating card beside a point inside its positioned parent, kept
	within the parent's edges. Esc or a press outside closes it.
-->
<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { clampInto, type Point } from './place.ts';

	interface Props {
		at: Point;
		label: string;
		onclose: () => void;
		children: Snippet;
	}

	let { at, label, onclose, children }: Props = $props();

	let card: HTMLDivElement;
	let pos = $state<Point | null>(null);

	onMount(() => {
		const parent = card.offsetParent as HTMLElement | null;
		// Open just right of and slightly above the point, like a calendar quick-add.
		const target = { x: at.x + 12, y: at.y - 24 };
		pos = parent
			? clampInto(target, { width: card.offsetWidth, height: card.offsetHeight }, { width: parent.clientWidth, height: parent.clientHeight })
			: target;
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onclose();
		}
	}

	function onWindowPointer(e: PointerEvent) {
		if (!card.contains(e.target as Node)) onclose();
	}
</script>

<svelte:window onpointerdowncapture={onWindowPointer} />

<div
	class="popover"
	role="dialog"
	aria-label={label}
	tabindex="-1"
	bind:this={card}
	style:left="{pos?.x ?? at.x}px"
	style:top="{pos?.y ?? at.y}px"
	style:opacity={pos ? 1 : 0}
	{onkeydown}
>
	{@render children()}
</div>

<style>
	.popover {
		position: absolute;
		z-index: 20;
		width: min(22rem, calc(100% - 16px));
		padding: 0.9rem 1rem;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-float);
	}
</style>
