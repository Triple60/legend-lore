<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { auth } from '#lib/session.svelte.ts';
	import { supabase } from '#lib/supabase.ts';

	let error = $state<string | null>(null);
	const userId = $derived(auth.user?.id ?? null);

	$effect(() => {
		const token = page.url.searchParams.get('token');
		if (!token) {
			error = 'This invite link is incomplete.';
			return;
		}
		if (!userId) {
			const here = `${resolve('/join')}?token=${encodeURIComponent(token)}`;
			goto(`${resolve('/login')}?next=${encodeURIComponent(here)}`, { replaceState: true });
			return;
		}
		supabase.rpc('accept_invite', { invite_token: token }).then(({ data, error: e }) => {
			if (e) error = e.message;
			else goto(`${resolve('/campaign')}?id=${data}`, { replaceState: true });
		});
	});
</script>

<div class="card join">
	{#if error}
		<h1>Can't join</h1>
		<p class="error">{error}</p>
		<p><a href={resolve('/')}>Back to your campaigns</a></p>
	{:else}
		<p class="muted">Joining campaign…</p>
	{/if}
</div>

<style>
	.join {
		width: calc(100% - 2rem);
		max-width: 28rem;
		margin: 3rem auto;
	}
</style>
