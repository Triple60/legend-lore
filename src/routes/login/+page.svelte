<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { auth } from '#lib/session.svelte.ts';
	import { supabase } from '#lib/supabase.ts';

	// Where to go after signing in (e.g. back to an invite link). Only same-site
	// paths are accepted, so this can't be abused as an open redirect.
	const next = $derived.by(() => {
		const n = page.url.searchParams.get('next') ?? '';
		return n.startsWith(resolve('/')) && !n.startsWith('//') ? n : resolve('/');
	});

	let email = $state('');
	let code = $state('');
	let sent = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);

	$effect(() => {
		if (auth.user) goto(next, { replaceState: true });
	});

	async function discord() {
		error = null;
		const redirectTo = `${location.origin}${resolve('/login')}?next=${encodeURIComponent(next)}`;
		const { error: e } = await supabase.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo } });
		if (e) error = e.message;
	}

	async function sendCode(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = null;
		const { error: err } = await supabase.auth.signInWithOtp({
			email: email.trim(),
			options: { shouldCreateUser: true }
		});
		busy = false;
		if (err) error = err.message;
		else sent = true;
	}

	async function verify(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = null;
		const { error: err } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
		busy = false;
		if (err) error = err.message;
	}
</script>

<div class="card login">
	<h1>Sign in</h1>
	<p class="muted">No passwords here: sign in with Discord, or get a one-time code by email.</p>

	<button class="discord" onclick={discord}>Continue with Discord</button>

	<div class="or"><span>or</span></div>

	{#if !sent}
		<form onsubmit={sendCode}>
			<input type="email" bind:value={email} placeholder="you@example.com" required autocomplete="email" />
			<button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button>
		</form>
	{:else}
		<form onsubmit={verify}>
			<p class="muted">We sent a code to <strong>{email}</strong>.</p>
			<input
				bind:value={code}
				inputmode="numeric"
				autocomplete="one-time-code"
				placeholder="Code from the email"
				required
			/>
			<button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
			<button type="button" class="ghost" onclick={() => ((sent = false), (code = ''))}>Use a different email</button>
		</form>
	{/if}

	{#if error}<p class="error">{error}</p>{/if}
</div>

<style>
	.login {
		width: calc(100% - 2rem);
		max-width: 24rem;
		margin: 3rem auto;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	h1 {
		margin: 0;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.discord {
		background: #5865f2;
		color: #fff;
	}
	.or {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--muted);
		font-size: 0.8rem;
	}
	.or::before,
	.or::after {
		content: '';
		flex: 1;
		border-top: 1px solid var(--border);
	}
</style>
