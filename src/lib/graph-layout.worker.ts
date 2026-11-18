/// <reference lib="webworker" />
// Runs the Reorganize search off the main thread, so the page (and the
// button's spinner) stay responsive while it works. See graph-layout.ts.
import { optimizeLayout, type LayoutEdge, type LayoutNode, type LayoutOptions } from './graph-layout.ts';

self.onmessage = (e: MessageEvent<{ nodes: LayoutNode[]; edges: LayoutEdge[]; options: LayoutOptions }>) => {
	const { nodes, edges, options } = e.data;
	self.postMessage([...optimizeLayout(nodes, edges, options)]);
};
