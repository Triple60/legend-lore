import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Menu from './Menu.svelte';

function setup() {
	const first = vi.fn();
	const second = vi.fn();
	const onclose = vi.fn();
	render(Menu, {
		at: { x: 100, y: 100 },
		label: 'Map',
		items: [
			{ label: 'New node here', hint: 'N', onselect: first },
			{ label: 'Re-layout', onselect: second }
		],
		onclose
	});
	return { user: userEvent.setup(), first, second, onclose };
}

describe('Menu', () => {
	it('focuses the first item, so Enter picks it', async () => {
		const { user, first, onclose } = setup();
		expect(screen.getByRole('menuitem', { name: /New node here/ })).toHaveFocus();
		await user.keyboard('{Enter}');
		expect(first).toHaveBeenCalledOnce();
		expect(onclose).toHaveBeenCalled();
	});

	it('moves between items with the arrow keys, wrapping around', async () => {
		const { user, second } = setup();
		await user.keyboard('{ArrowDown}');
		expect(screen.getByRole('menuitem', { name: 'Re-layout' })).toHaveFocus();
		await user.keyboard('{ArrowDown}');
		expect(screen.getByRole('menuitem', { name: /New node here/ })).toHaveFocus();
		await user.keyboard('{ArrowUp}{Enter}');
		expect(second).toHaveBeenCalledOnce();
	});

	it('closes on Escape or a click outside, without picking anything', async () => {
		const { user, first, onclose } = setup();
		await user.keyboard('{Escape}');
		expect(onclose).toHaveBeenCalledTimes(1);
		await user.click(document.body);
		expect(onclose).toHaveBeenCalledTimes(2);
		expect(first).not.toHaveBeenCalled();
	});
});
