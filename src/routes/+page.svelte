<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { auth } from '#lib/session.svelte.ts';
	import { supabase } from '#lib/supabase.ts';
	import type { Campaign } from '#lib/types.ts';

	let campaigns = $state<Campaign[] | null>(null);
	let name = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);

	const userId = $derived(auth.user?.id ?? null);

	$effect(() => {
		if (!userId) {
			goto(resolve('/login'), { replaceState: true });
			return;
		}
		supabase
			.from('campaigns')
			.select('*')
			.order('created_at', { ascending: false })
			.then(({ data, error: e }) => {
				if (e) error = e.message;
				else campaigns = data;
			});
	});

	async function create(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		const { data, error: err } = await supabase.from('campaigns').insert({ name: name.trim() }).select().single();
		busy = false;
		if (err) error = err.message;
		else goto(`${resolve('/campaign')}?id=${data.id}`);
	}
</script>

<div class="page">
	<h1>Your campaigns</h1>
	{#if error}<p class="error">{error}</p>{/if}

	{#if campaigns === null}
		<p class="muted">Loading…</p>
	{:else if campaigns.length === 0}
		<p class="muted">No campaigns yet. Create one, or ask a party member for an invite link.</p>
	{:else}
		<ul class="list">
			{#each campaigns as c (c.id)}
				<li><a class="card" href={`${resolve('/campaign')}?id=${c.id}`}>{c.name}</a></li>
			{/each}
		</ul>
	{/if}

	<form class="new" onsubmit={create}>
		<input bind:value={name} placeholder="New campaign name" required maxlength="200" />
		<button type="submit" disabled={busy || !name.trim()}>Create</button>
	</form>
</div>

<style>
	.page {
		width: 100%;
		max-width: 40rem;
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}
	.list {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.list a {
		display: block;
		padding: 1rem 1.25rem;
		color: var(--text);
		text-decoration: none;
		font-weight: 600;
	}
	.list a:hover {
		border-color: var(--accent);
	}
	.new {
		display: flex;
		gap: 0.5rem;
		margin-top: 1.5rem;
	}
	.new input {
		flex: 1;
		min-width: 0;
	}
</style>
