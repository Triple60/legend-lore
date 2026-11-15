import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEdge, makeNode, makeType } from '../../tests/fixtures';

vi.mock('../supabase', async () => {
	const { createFakeSupabase } = await import('../../tests/fake-supabase');
	return { supabase: createFakeSupabase().client, isConfigured: true };
});

const { CampaignStore } = await import('../campaign.svelte');
const { default: NodePanel } = await import('./NodePanel.svelte');

const person = makeType({ id: 'person', label: 'Person' });
const place = makeType({ id: 'place', label: 'Place', sort_order: 1 });

let store: InstanceType<typeof CampaignStore>;
let strahd: ReturnType<typeof makeNode>;
let village: ReturnType<typeof makeNode>;

beforeEach(() => {
	strahd = makeNode({
		id: 'strahd',
		type_id: 'person',
		name: 'Strahd',
		aliases: ['The Devil', 'The Ancient'],
		tags: ['vampire'],
		notes: 'Lives above [[Village of Barovia|the village]].',
		session_number: 1
	});
	village = makeNode({ id: 'village', type_id: 'place', name: 'Village of Barovia', aliases: ['Barovia'] });
	store = new CampaignStore('camp-1', { id: 'user-me', name: 'Me' });
	store.types = { person, place };
	store.nodes = { strahd, village };
});

function setup() {
	const onselect = vi.fn();
	const ontag = vi.fn();
	render(NodePanel, { store, nodeId: 'strahd', onselect, ontag });
	return { user: userEvent.setup(), onselect, ontag };
}

describe('NodePanel', () => {
	it('shows the type, name, aliases, tags and first session', () => {
		setup();
		expect(screen.getByRole('heading', { name: 'Strahd' })).toBeInTheDocument();
		expect(screen.getByText('Person')).toBeInTheDocument();
		expect(screen.getByText('a.k.a. The Devil, The Ancient')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: '#vampire' })).toBeInTheDocument();
		expect(screen.getByText('Session 1')).toBeInTheDocument();
	});

	it('hides the a.k.a. line when there are no aliases', () => {
		store.nodes.strahd = { ...strahd, aliases: [] };
		setup();
		expect(screen.queryByText(/a\.k\.a\./)).not.toBeInTheDocument();
	});

	it('filters by a tag when it is clicked', async () => {
		const { user, ontag } = setup();
		await user.click(screen.getByRole('button', { name: '#vampire' }));
		expect(ontag).toHaveBeenCalledWith('vampire');
	});

	it('follows [[wiki links]] in notes', async () => {
		const { user, onselect } = setup();
		await user.click(screen.getByRole('link', { name: 'the village' }));
		expect(onselect).toHaveBeenCalledWith('village');
	});

	it('says when a node is gone', () => {
		store.nodes = {};
		setup();
		expect(screen.getByText(/no longer exists/i)).toBeInTheDocument();
	});

	it('opens the edit form when the lock is free', async () => {
		const { user } = setup();
		await user.click(screen.getByRole('button', { name: 'Edit' }));
		expect(screen.getByRole('heading', { name: 'Editing' })).toBeInTheDocument();
		expect(screen.getByLabelText(/^name/i)).toHaveValue('Strahd');
	});

	it('blocks editing while someone else holds the lock', () => {
		store.online = [{ user_id: 'user-other', name: 'Alice', editing: 'strahd', since: 1 }];
		setup();
		expect(screen.getByText(/Alice is editing this/)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
	});

	describe('connections', () => {
		it('has no form for adding connections (they are drawn on the map)', () => {
			setup();
			expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
			expect(screen.getByText(/Shift\+click another node/)).toBeInTheDocument();
		});

		it('lists connections in both directions', () => {
			const ireena = makeNode({ id: 'ireena', name: 'Ireena' });
			store.nodes.ireena = ireena;
			store.edges = {
				out: makeEdge({ id: 'out', from_id: 'strahd', to_id: 'village', annotation: 'rules', session_number: 2 }),
				in: makeEdge({ id: 'in', from_id: 'ireena', to_id: 'strahd', annotation: 'fears' })
			};
			setup();
			const items = screen.getAllByRole('listitem');
			expect(items[0]).toHaveTextContent(/^Strahd rules Village of Barovia \(s2\)/);
			expect(items[1]).toHaveTextContent(/^Ireena fears Strahd/);
		});

		it('shows an arrow for a connection with no annotation', async () => {
			store.edges = { e: makeEdge({ id: 'e', from_id: 'strahd', to_id: 'village' }) };
			const { user, onselect } = setup();
			expect(screen.getByRole('listitem')).toHaveTextContent(/^Strahd → Village of Barovia/);
			await user.click(within(screen.getByRole('listitem')).getByRole('button', { name: 'Village of Barovia' }));
			expect(onselect).toHaveBeenCalledWith('village');
		});

		it('edits a connection’s session number (regression)', async () => {
			const edge = makeEdge({ id: 'e', from_id: 'strahd', to_id: 'village', annotation: 'rules', session_number: 2 });
			store.edges = { e: edge };
			const updateEdge = vi.spyOn(store, 'updateEdge').mockResolvedValue(edge);
			const { user } = setup();
			await user.click(screen.getByTitle('Edit'));
			const item = within(screen.getByRole('listitem'));
			const session = item.getByPlaceholderText('sess.');
			expect(session).toHaveValue(2);
			await user.clear(session);
			await user.type(session, '7');
			await user.click(item.getByRole('button', { name: 'Save' }));
			expect(updateEdge).toHaveBeenCalledWith(edge, { annotation: 'rules', session_number: 7 });
		});

		it('clears a connection’s session number', async () => {
			const edge = makeEdge({ id: 'e', from_id: 'strahd', to_id: 'village', session_number: 2 });
			store.edges = { e: edge };
			const updateEdge = vi.spyOn(store, 'updateEdge').mockResolvedValue(edge);
			const { user } = setup();
			await user.click(screen.getByTitle('Edit'));
			const item = within(screen.getByRole('listitem'));
			await user.clear(item.getByPlaceholderText('sess.'));
			await user.click(item.getByRole('button', { name: 'Save' }));
			expect(updateEdge).toHaveBeenCalledWith(edge, { annotation: '', session_number: null });
		});

		it('shows save errors', async () => {
			const edge = makeEdge({ id: 'e', from_id: 'strahd', to_id: 'village' });
			store.edges = { e: edge };
			vi.spyOn(store, 'updateEdge').mockRejectedValue(new Error('permission denied'));
			const { user } = setup();
			await user.click(screen.getByTitle('Edit'));
			await user.click(screen.getByRole('button', { name: 'Save' }));
			expect(await screen.findByText('permission denied')).toBeInTheDocument();
		});
	});
});
