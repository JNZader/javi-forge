import type {
	WorkflowGraph,
	WorkflowValidationResult,
} from "../../types/index.js";

/**
 * Render a WorkflowGraph as ASCII art.
 * Linear pipelines render as: [lint] -> [test] -> [build]
 * Branching renders with indentation.
 * Optionally overlays validation results with pass/fail icons.
 */
export function renderAscii(
	graph: WorkflowGraph,
	validationResults?: WorkflowValidationResult[],
): string {
	if (graph.nodes.length === 0) return "(empty graph)";

	const resultMap = new Map<string, WorkflowValidationResult>();
	if (validationResults) {
		for (const r of validationResults) {
			resultMap.set(r.node, r);
		}
	}

	// Build adjacency and in-degree
	const adjacency = new Map<string, string[]>();
	const inDegree = new Map<string, number>();

	for (const node of graph.nodes) {
		adjacency.set(node.id, []);
		inDegree.set(node.id, 0);
	}

	for (const edge of graph.edges) {
		const children = adjacency.get(edge.from);
		if (children) children.push(edge.to);
		inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
	}

	// Find roots (in-degree 0)
	const roots = graph.nodes
		.filter((n) => (inDegree.get(n.id) ?? 0) === 0)
		.map((n) => n.id);

	if (roots.length === 0) {
		// Cycle — just list all nodes
		return graph.nodes
			.map((n) => formatNode(n.id, n.label, resultMap))
			.join(" -> ");
	}

	// Topological order using Kahn's algorithm
	const queue = [...roots];
	const ordered: string[] = [];
	const visited = new Set<string>();

	while (queue.length > 0) {
		const current = queue.shift()!;
		if (visited.has(current)) continue;
		visited.add(current);
		ordered.push(current);

		const children = adjacency.get(current) ?? [];
		for (const child of children) {
			const deg = (inDegree.get(child) ?? 1) - 1;
			inDegree.set(child, deg);
			if (deg <= 0 && !visited.has(child)) {
				queue.push(child);
			}
		}
	}

	// Add any unvisited nodes (disconnected)
	for (const node of graph.nodes) {
		if (!visited.has(node.id)) ordered.push(node.id);
	}

	// Build label map
	const labelMap = new Map<string, string>();
	for (const node of graph.nodes) {
		labelMap.set(node.id, node.label);
	}

	// Build edge label map
	const edgeLabelMap = new Map<string, string>();
	for (const edge of graph.edges) {
		const key = `${edge.from}->${edge.to}`;
		if (edge.label) edgeLabelMap.set(key, edge.label);
	}

	// Render: try linear first, fall back to tree-like
	const lines: string[] = [];
	lines.push(`# ${graph.name}`);
	lines.push("");

	// Check if it's a simple linear chain
	const isLinear =
		graph.nodes.every((n) => {
			const children = adjacency.get(n.id) ?? [];
			return children.length <= 1;
		}) && roots.length === 1;

	if (isLinear) {
		const chain: string[] = [];
		let current: string | undefined = roots[0];
		while (current) {
			chain.push(
				formatNode(current, labelMap.get(current) ?? current, resultMap),
			);
			const children = adjacency.get(current) ?? [];
			const next = children[0];
			if (next) {
				const edgeKey = `${current}->${next}`;
				const edgeLabel = edgeLabelMap.get(edgeKey);
				if (edgeLabel) {
					chain.push(`--(${edgeLabel})-->`);
				}
			}
			current = next;
		}
		lines.push(chain.join(" -> ").replace(/ -> --/g, " --"));
	} else {
		// Tree-like rendering
		for (const nodeId of ordered) {
			const children = adjacency.get(nodeId) ?? [];
			const nodeStr = formatNode(
				nodeId,
				labelMap.get(nodeId) ?? nodeId,
				resultMap,
			);

			if (children.length === 0) {
				lines.push(`  ${nodeStr}`);
			} else {
				const childStrs = children.map((c) => {
					const edgeKey = `${nodeId}->${c}`;
					const edgeLabel = edgeLabelMap.get(edgeKey);
					const arrow = edgeLabel ? `--(${edgeLabel})-->` : "->";
					return `${arrow} ${formatNode(c, labelMap.get(c) ?? c, resultMap)}`;
				});
				if (childStrs.length === 1) {
					lines.push(`  ${nodeStr} ${childStrs[0]}`);
				} else {
					lines.push(`  ${nodeStr}`);
					for (const cs of childStrs) {
						lines.push(`    ${cs}`);
					}
				}
			}
		}
	}

	// Add validation legend if results are present
	if (validationResults && validationResults.length > 0) {
		lines.push("");
		lines.push("---");
		for (const r of validationResults) {
			const icon =
				r.status === "pass" ? "\u2713" : r.status === "fail" ? "\u2717" : "-";
			lines.push(`  ${icon} ${r.node}${r.detail ? `: ${r.detail}` : ""}`);
		}
	}

	return lines.join("\n");
}

function formatNode(
	id: string,
	label: string,
	resultMap: Map<string, WorkflowValidationResult>,
): string {
	const result = resultMap.get(id);
	if (result) {
		const icon =
			result.status === "pass"
				? "\u2713"
				: result.status === "fail"
					? "\u2717"
					: "?";
		return `[${icon} ${label}]`;
	}
	return `[${label}]`;
}
