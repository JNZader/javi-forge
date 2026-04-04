import type {
	WorkflowEdge,
	WorkflowGraph,
	WorkflowNode,
} from "../../types/index.js";

export class WorkflowParseError extends Error {
	constructor(
		message: string,
		public readonly line?: number,
	) {
		super(line !== undefined ? `Line ${line}: ${message}` : message);
		this.name = "WorkflowParseError";
	}
}

// ── DOT Parser ──────────────────────────────────────────────────────────────

/**
 * Parse a DOT digraph string into a WorkflowGraph.
 * Supports subset: `digraph [name] { A -> B; A [label="X" check="Y"]; }`
 */
export function parseDot(
	content: string,
	sourceName = "untitled",
): WorkflowGraph {
	const trimmed = content.trim();

	// Extract digraph header
	const headerMatch = trimmed.match(/^digraph\s+(?:"([^"]+)"|(\w+))?\s*\{/i);
	if (!headerMatch) {
		throw new WorkflowParseError(
			'Expected "digraph [name] {" at start of file',
		);
	}

	const graphName = headerMatch[1] ?? headerMatch[2] ?? sourceName;

	// Extract body between first { and last }
	const openBrace = trimmed.indexOf("{");
	const closeBrace = trimmed.lastIndexOf("}");
	if (openBrace === -1 || closeBrace === -1 || closeBrace <= openBrace) {
		throw new WorkflowParseError("Malformed digraph: missing braces");
	}

	const body = trimmed.slice(openBrace + 1, closeBrace);
	const nodesMap = new Map<string, WorkflowNode>();
	const edges: WorkflowEdge[] = [];

	// Split by semicolons or newlines
	const statements = body
		.split(/[;\n]/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0 && !s.startsWith("//") && !s.startsWith("#"));

	for (const stmt of statements) {
		// Skip graph-level attributes like rankdir=LR
		if (/^\w+=/.test(stmt) && !stmt.includes("->")) continue;

		// Edge: A -> B [label="..."]
		const edgeMatch = stmt.match(
			/^"?(\w[\w\s-]*?)"?\s*->\s*"?(\w[\w\s-]*?)"?\s*(?:\[([^\]]*)\])?\s*$/,
		);
		if (edgeMatch) {
			const fromId = edgeMatch[1]!.trim();
			const toId = edgeMatch[2]!.trim();
			const attrs = edgeMatch[3] ? parseAttributes(edgeMatch[3]) : {};

			ensureNode(nodesMap, fromId);
			ensureNode(nodesMap, toId);
			edges.push({ from: fromId, to: toId, label: attrs["label"] });
			continue;
		}

		// Node: A [label="..." check="..."]
		const nodeMatch = stmt.match(/^"?(\w[\w\s-]*?)"?\s*\[([^\]]+)\]\s*$/);
		if (nodeMatch) {
			const nodeId = nodeMatch[1]!.trim();
			const attrs = parseAttributes(nodeMatch[2]!);
			const node = ensureNode(nodesMap, nodeId);
			if (attrs["label"]) node.label = attrs["label"];
			if (attrs["check"]) node.check = attrs["check"];
			// Store remaining attrs as metadata
			const { label: _l, check: _c, ...rest } = attrs;
			if (Object.keys(rest).length > 0) node.metadata = rest;
			continue;
		}

		// Chained edge: A -> B -> C
		const chainMatch = stmt.match(/^[\w\s"-]+(?:\s*->\s*[\w\s"-]+)+$/);
		if (chainMatch) {
			const parts = stmt.split("->").map((p) => p.trim().replace(/^"|"$/g, ""));
			for (let i = 0; i < parts.length - 1; i++) {
				const fromId = parts[i]!.trim();
				const toId = parts[i + 1]!.trim();
				ensureNode(nodesMap, fromId);
				ensureNode(nodesMap, toId);
				edges.push({ from: fromId, to: toId });
			}
		}
	}

	if (nodesMap.size === 0) {
		throw new WorkflowParseError("No nodes found in digraph");
	}

	return {
		name: graphName,
		nodes: Array.from(nodesMap.values()),
		edges,
		format: "dot",
	};
}

// ── Mermaid Parser ──────────────────────────────────────────────────────────

/**
 * Parse a Mermaid flowchart string into a WorkflowGraph.
 * Supports subset: `flowchart LR/TD`, `A --> B`, `A[Label]`, `A -->|label| B`
 */
export function parseMermaid(
	content: string,
	sourceName = "untitled",
): WorkflowGraph {
	const lines = content
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);

	if (lines.length === 0) {
		throw new WorkflowParseError("Empty mermaid file");
	}

	// First line must be flowchart directive
	const headerMatch = lines[0]!.match(
		/^(?:flowchart|graph)\s+(LR|TD|TB|RL|BT)/i,
	);
	if (!headerMatch) {
		throw new WorkflowParseError(
			'Expected "flowchart LR|TD" or "graph LR|TD" at first line',
			1,
		);
	}

	const nodesMap = new Map<string, WorkflowNode>();
	const edges: WorkflowEdge[] = [];

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i]!;

		// Skip comments and style directives
		if (
			line.startsWith("%%") ||
			line.startsWith("style") ||
			line.startsWith("classDef")
		) {
			continue;
		}

		// Edge with label: A -->|label| B  or  A -- label --> B
		const edgeLabelMatch = line.match(
			/^(\w[\w-]*?)(?:\[([^\]]+)\])?\s*-->?\|([^|]+)\|\s*(\w[\w-]*?)(?:\[([^\]]+)\])?\s*$/,
		);
		if (edgeLabelMatch) {
			const fromId = edgeLabelMatch[1]!;
			const fromLabel = edgeLabelMatch[2];
			const edgeLabel = edgeLabelMatch[3]!.trim();
			const toId = edgeLabelMatch[4]!;
			const toLabel = edgeLabelMatch[5];

			const fromNode = ensureNode(nodesMap, fromId);
			if (fromLabel) fromNode.label = fromLabel;
			const toNode = ensureNode(nodesMap, toId);
			if (toLabel) toNode.label = toLabel;
			edges.push({ from: fromId, to: toId, label: edgeLabel });
			continue;
		}

		// Simple edge: A --> B  (possibly chained: A --> B --> C)
		// Also handles node labels: A[Label] --> B[Label]
		const edgeMatch = line.match(/(\w[\w-]*?)(?:\[([^\]]+)\])?\s*-->?\s*/);
		if (edgeMatch && line.includes("-->")) {
			const segments = line.split(/\s*-->\s*/);
			for (let s = 0; s < segments.length; s++) {
				const seg = segments[s]!.trim();
				const segMatch = seg.match(/^(\w[\w-]*)(?:\[([^\]]+)\])?$/);
				if (segMatch) {
					const nodeId = segMatch[1]!;
					const nodeLabel = segMatch[2];
					const node = ensureNode(nodesMap, nodeId);
					if (nodeLabel) node.label = nodeLabel;
				}
			}
			// Create edges between consecutive segments
			for (let s = 0; s < segments.length - 1; s++) {
				const fromSeg = segments[s]!.trim().match(/^(\w[\w-]*)/);
				const toSeg = segments[s + 1]!.trim().match(/^(\w[\w-]*)/);
				if (fromSeg && toSeg) {
					edges.push({ from: fromSeg[1]!, to: toSeg[1]! });
				}
			}
			continue;
		}

		// Standalone node with label: A[Label]
		const nodeMatch = line.match(/^(\w[\w-]*)\[([^\]]+)\]\s*$/);
		if (nodeMatch) {
			const node = ensureNode(nodesMap, nodeMatch[1]!);
			node.label = nodeMatch[2]!;
		}
	}

	if (nodesMap.size === 0) {
		throw new WorkflowParseError("No nodes found in flowchart");
	}

	return {
		name: sourceName,
		nodes: Array.from(nodesMap.values()),
		edges,
		format: "mermaid",
	};
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function ensureNode(
	nodesMap: Map<string, WorkflowNode>,
	id: string,
): WorkflowNode {
	let node = nodesMap.get(id);
	if (!node) {
		node = { id, label: id };
		nodesMap.set(id, node);
	}
	return node;
}

function parseAttributes(attrStr: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	// Match key="value" or key=value pairs
	const regex = /(\w+)\s*=\s*(?:"([^"]*)"|(\S+))/g;
	let match: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec loop
	while ((match = regex.exec(attrStr)) !== null) {
		attrs[match[1]!] = match[2] ?? match[3] ?? "";
	}
	return attrs;
}
