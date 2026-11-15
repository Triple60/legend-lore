<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import '#lib/ui/tokens.css';
	import { resolve } from '$app/paths';
	import { auth } from '#lib/session.svelte.ts';
	import { theme } from '#lib/theme.svelte.ts';
	import { isConfigured, isDemo, supabase } from '#lib/supabase.ts';
	import { onMount } from 'svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	onMount(() => auth.start());
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app">
	<nav>
		<a class="brand" href={resolve('/')}>Legend Lore</a>
		{#if isDemo}
			<span class="demo" title="Changes stay in this tab and are lost when you reload the page.">
				Demo · sample data, resets on reload
			</span>
		{/if}
		<span class="spacer"></span>
		<button
			class="ghost small theme"
			role="switch"
			aria-checked={theme.current === 'dark'}
			aria-label="Dark mode"
			title={theme.current === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
			onclick={() => theme.toggle()}
		>
			<span aria-hidden="true">{theme.current === 'dark' ? '☾' : '☀'}</span>
		</button>
		{#if auth.user}
			<span class="muted who">{auth.user.email ?? auth.user.user_metadata?.full_name}</span>
			<button class="ghost small" onclick={() => supabase.auth.signOut()}>{isDemo ? 'Reset demo' : 'Sign out'}</button>
		{/if}
	</nav>

	<main>
		{#if !isConfigured}
			<div class="card setup">
				<h1>Almost there</h1>
				<p>
					This build has no Supabase project configured. Set <code>PUBLIC_SUPABASE_URL</code> and
					<code>PUBLIC_SUPABASE_ANON_KEY</code> (in <code>.env</code> locally, or as repository variables
					for the GitHub Pages build). See the README for setup steps.
				</p>
			</div>
		{:else if !auth.ready}
			<p class="muted center">Loading…</p>
		{:else}
			{@render children()}
		{/if}
	</main>
</div>

<style>
	:global(body) {
		margin: 0;
		background: var(--bg);
	}
	:global(*, *::before, *::after) {
		box-sizing: border-box;
	}
	:global(input, select, textarea, button) {
		font: inherit;
		color: inherit;
	}
	:global(input, select, textarea) {
		background: var(--input);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.45rem 0.6rem;
	}
	:global(button) {
		background: var(--accent);
		color: #1a1408;
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 0.45rem 0.9rem;
		cursor: pointer;
		font-weight: 600;
	}
	:global(button:disabled) {
		opacity: 0.5;
		cursor: default;
	}
	:global(button.ghost) {
		background: transparent;
		color: var(--text);
		border-color: var(--border);
		font-weight: 500;
	}
	:global(button.danger) {
		color: var(--danger);
	}
	:global(button.small) {
		padding: 0.15rem 0.5rem;
		font-size: 0.8rem;
	}
	:global(button.link) {
		background: none;
		border: none;
		padding: 0;
		color: var(--accent);
		font-weight: 500;
		text-decoration: underline;
	}
	:global(button.tag) {
		background: var(--input);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.1rem 0.6rem;
		font-size: 0.8rem;
		font-weight: 500;
	}
	:global(.muted) {
		color: var(--muted);
	}
	:global(.error) {
		color: var(--danger);
	}
	:global(.center) {
		text-align: center;
	}
	:global(.card) {
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 1.5rem;
	}
	.app {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
	}
	nav {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 1rem;
		border-bottom: 1px solid var(--border);
		background: var(--panel);
	}
	.brand {
		font-weight: 700;
		color: var(--accent);
		text-decoration: none;
		letter-spacing: 0.02em;
	}
	.demo {
		font-size: 0.75rem;
		color: var(--muted);
		border: 1px dashed var(--border);
		border-radius: 999px;
		padding: 0.1rem 0.6rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.spacer {
		flex: 1;
	}
	.theme {
		min-width: 2rem;
		font-size: 0.95rem;
		line-height: 1.4;
	}
	.who {
		font-size: 0.85rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 40vw;
	}
	main {
		flex: 1;
		display: flex;
		flex-direction: column;
	}
	.setup {
		max-width: 36rem;
		margin: 3rem auto;
	}
</style>
