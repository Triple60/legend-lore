import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makeType } from '../../tests/fixtures';
import NodeQuickForm from './NodeQuickForm.svelte';

const place = makeType({ id: 'place', label: 'Place', sort_order: 0 });
const person = makeType({ id: 'person', label: 'Person', sort_order: 1 });

function setup() {
	const onsave = vi.fn();
	const onexpand = vi.fn();
	render(NodeQuickForm, { types: [place, person], onsave, onexpand });
	return { user: userEvent.setup(), onsave, onexpand };
}

describe('NodeQuickForm', () => {
	it('starts in Name and saves on Enter with the first type', async () => {
		const { user, onsave } = setup();
		expect(screen.getByLabelText('Name')).toHaveFocus();
		await user.keyboard('  Strahd {Enter}');
		expect(onsave).toHaveBeenCalledWith({
			name: 'Strahd',
			type_id: 'place',
			aliases: [],
			tags: [],
			notes: '',
			session_number: null
		});
	});

	it('does not save without a name', async () => {
		const { user, onsave } = setup();
		expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
		await user.keyboard('{Enter}');
		expect(onsave).not.toHaveBeenCalled();
	});

	it('saves the chosen type and tags', async () => {
		const { user, onsave } = setup();
		await user.type(screen.getByLabelText('Name'), 'Strahd');
		await user.click(screen.getByRole('radio', { name: 'Person' }));
		await user.type(screen.getByLabelText('Tags'), 'vampire, villain');
		await user.click(screen.getByRole('button', { name: 'Save' }));
		expect(onsave).toHaveBeenCalledWith(expect.objectContaining({ type_id: 'person', tags: ['vampire', 'villain'] }));
	});

	it('hands what is typed so far to the side panel', async () => {
		const { user, onexpand } = setup();
		await user.type(screen.getByLabelText('Name'), 'Strahd');
		await user.click(screen.getByRole('button', { name: 'Open in side panel' }));
		expect(onexpand).toHaveBeenCalledWith(expect.objectContaining({ name: 'Strahd', type_id: 'place' }));
	});

	it('saves a description as the node’s notes, keeping new lines', async () => {
		const { user, onsave } = setup();
		await user.type(screen.getByLabelText('Name'), 'Strahd');
		await user.type(screen.getByLabelText('Description'), 'Line one{Enter}Line two');
		expect(onsave).not.toHaveBeenCalled();
		await user.keyboard('{Control>}{Enter}{/Control}');
		expect(onsave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Strahd', notes: 'Line one\nLine two' }));
	});

	it('hands the description to the side panel too', async () => {
		const { user, onexpand } = setup();
		await user.type(screen.getByLabelText('Name'), 'Strahd');
		await user.type(screen.getByLabelText('Description'), 'A vampire');
		await user.click(screen.getByRole('button', { name: 'Open in side panel' }));
		expect(onexpand).toHaveBeenCalledWith(expect.objectContaining({ notes: 'A vampire' }));
	});
});
