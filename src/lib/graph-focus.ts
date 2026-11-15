import type { Core } from 'cytoscape';

/**
 * Set the graph's highlight classes.
 *
 * - A search (`highlight`) fades everything outside its results.
 * - Otherwise a selected node fades everything except itself, its
 *   connections and the nodes at their other ends.
 * - The selected node gets `selected`, and its connections `connected`.
 */
export function applyGraphFocus(cy: Core, selectedId: string | null, highlight: Set<string> | null) {
	const selected = selectedId ? cy.getElementById(selectedId) : cy.collection();
	const hood = selected.nonempty() ? selected.closedNeighborhood() : null;

	cy.batch(() => {
		cy.nodes().forEach((n) => {
			const faded = highlight ? !highlight.has(n.id()) : Boolean(hood && !hood.has(n));
			n.toggleClass('selected', n.id() === selectedId);
			n.toggleClass('faded', faded);
		});
		cy.edges().forEach((e) => {
			const faded = highlight
				? !(highlight.has(e.source().id()) && highlight.has(e.target().id()))
				: Boolean(hood && !hood.has(e));
			e.toggleClass('connected', selected.nonempty() && e.connectedNodes().contains(selected));
			e.toggleClass('faded', faded);
		});
	});
}
