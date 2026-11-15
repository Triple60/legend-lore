import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TypeEditor from './TypeEditor.svelte';

function setup(props: Record<string, unknown> = {}) {
	const anchor = document.createElement('button');
	document.body.append(anchor);
	const onsave = vi.fn();
	const onclose = vi.fn();
	render(TypeEditor, { props: { anchor, heading: 'Rename “Place”', onsave, onclose, ...props } });
	return { user: userEvent.setup(), onsave, onclose };
}

describe('TypeEditor', () => {
	it('starts with the current name selected and saves the new one', async () => {
		const { user, onsave } = setup({ initial: { label: 'Place', color: '#4e79a7' } });
		const name = screen.getByLabelText('Name');
		expect(name).toHaveValue('Place');
		expect(name).toHaveFocus();
		await user.keyboard('Location{Enter}');
		expect(onsave).toHaveBeenCalledWith('Location', '#4e79a7');
	});

	it('closes on Esc without saving', async () => {
		const { user, onsave, onclose } = setup();
		await user.keyboard('{Escape}');
		expect(onclose).toHaveBeenCalled();
		expect(onsave).not.toHaveBeenCalled();
	});

	it('needs a name', () => {
		setup({ submitLabel: 'Add' });
		expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
	});
});
