import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makeNode, makeType } from '../../tests/fixtures';
import NodeForm from './NodeForm.svelte';

const place = makeType({ id: 'place', label: 'Place', sort_order: 0 });
const person = makeType({ id: 'person', label: 'Person', sort_order: 1 });

function setup(props: Partial<{ initial: Parameters<typeof makeNode>[0]; saving: boolean }> = {}) {
	const onsave = vi.fn();
	const oncancel = vi.fn();
	render(NodeForm, { types: [place, person], onsave, oncancel, ...props });
	const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
	return {
		user: userEvent.setup(),
		onsave,
		oncancel,
		name: field(/^name/i),
		type: field(/^type/i) as unknown as HTMLSelectElement,
		session: field(/^session/i),
		aliases: field(/also known as/i),
		tags: field(/^tags/i),
		notes: field(/^notes/i),
		save: screen.getByRole('button', { name: /^sav/i }),
		cancel: screen.getByRole('button', { name: 'Cancel' })
	};
}

describe('NodeForm', () => {
	it('labels Name and Type as required and the rest as optional', () => {
		const f = setup();
		expect(f.name.closest('label')).toHaveTextContent(/required/);
		expect(f.type.closest('label')).toHaveTextContent(/required/);
		for (const el of [f.session, f.aliases, f.tags, f.notes]) {
			expect(el.closest('label')).toHaveTextContent(/optional/);
		}
		expect(f.name).toBeRequired();
		expect(f.aliases).not.toBeRequired();
	});

	it('puts the cursor in Name when it opens', () => {
		const f = setup();
		expect(f.name).toHaveFocus();
	});

	it('disables Save until a name is entered', async () => {
		const f = setup();
		expect(f.save).toBeDisabled();
		await f.user.type(f.name, '   ');
		expect(f.save).toBeDisabled();
		await f.user.type(f.name, 'Strahd');
		expect(f.save).toBeEnabled();
	});

	it('saves with only a name, leaving every optional field empty', async () => {
		const f = setup();
		await f.user.type(f.name, '  Strahd  ');
		await f.user.click(f.save);
		expect(f.onsave).toHaveBeenCalledWith({
			name: 'Strahd',
			type_id: 'place',
			aliases: [],
			tags: [],
			notes: '',
			session_number: null
		});
	});

	// Regression: number inputs bind to numbers, and calling .trim() on one
	// threw "o(...).trim is not a function" when a session was entered.
	it('saves a session number as a number', async () => {
		const f = setup();
		await f.user.type(f.name, 'Strahd');
		await f.user.type(f.session, '3');
		await f.user.click(f.save);
		expect(f.onsave).toHaveBeenCalledWith(expect.objectContaining({ session_number: 3 }));
	});

	it('treats a cleared session field as no session', async () => {
		const f = setup();
		await f.user.type(f.name, 'Strahd');
		await f.user.type(f.session, '3');
		await f.user.clear(f.session);
		await f.user.click(f.save);
		expect(f.onsave).toHaveBeenCalledWith(expect.objectContaining({ session_number: null }));
	});

	it('accepts session 0', async () => {
		const f = setup();
		await f.user.type(f.name, 'Strahd');
		await f.user.type(f.session, '0');
		await f.user.click(f.save);
		expect(f.onsave).toHaveBeenCalledWith(expect.objectContaining({ session_number: 0 }));
	});

	it('splits comma-separated aliases and tags however they are spaced', async () => {
		const f = setup();
		await f.user.type(f.name, 'Strahd');
		await f.user.type(f.aliases, 'The Devil,  The Ancient ,');
		await f.user.type(f.tags, 'vampire,villain, barovia');
		await f.user.click(f.save);
		expect(f.onsave).toHaveBeenCalledWith(
			expect.objectContaining({ aliases: ['The Devil', 'The Ancient'], tags: ['vampire', 'villain', 'barovia'] })
		);
	});

	it('uses the chosen type', async () => {
		const f = setup();
		await f.user.type(f.name, 'Ireena');
		await f.user.selectOptions(f.type, 'Person');
		await f.user.click(f.save);
		expect(f.onsave).toHaveBeenCalledWith(expect.objectContaining({ type_id: 'person' }));
	});

	it('is pre-filled when editing, and saves the values back unchanged', async () => {
		const initial = makeNode({
			name: 'Strahd',
			type_id: 'person',
			aliases: ['The Devil', 'The Ancient'],
			tags: ['vampire'],
			notes: '# Notes',
			session_number: 2
		});
		const f = setup({ initial });
		expect(f.name).toHaveValue('Strahd');
		expect(f.type).toHaveValue('person');
		expect(f.aliases).toHaveValue('The Devil, The Ancient');
		expect(f.session).toHaveValue(2);
		await f.user.click(f.save);
		expect(f.onsave).toHaveBeenCalledWith({
			name: 'Strahd',
			type_id: 'person',
			aliases: ['The Devil', 'The Ancient'],
			tags: ['vampire'],
			notes: '# Notes',
			session_number: 2
		});
	});

	it('calls oncancel', async () => {
		const f = setup();
		await f.user.click(f.cancel);
		expect(f.oncancel).toHaveBeenCalled();
		expect(f.onsave).not.toHaveBeenCalled();
	});

	it('disables both buttons while saving', () => {
		const f = setup({ initial: makeNode({ name: 'Strahd' }), saving: true });
		expect(f.save).toHaveTextContent('Saving…');
		expect(f.save).toBeDisabled();
		expect(f.cancel).toBeDisabled();
	});

	it('starts from a draft handed over by the quick-add popover', () => {
		const f = setup({ initial: { name: 'Strahd', type_id: 'person', tags: ['vampire'] } });
		expect(f.name).toHaveValue('Strahd');
		expect(f.type).toHaveValue('person');
		expect(f.tags).toHaveValue('vampire');
		expect(f.aliases).toHaveValue('');
		expect(f.notes).toHaveValue('');
	});
});
