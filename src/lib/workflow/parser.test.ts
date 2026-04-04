import { describe, expect, it } from "vitest";
import { parseDot, parseMermaid, WorkflowParseError } from "./parser.js";

describe("parseDot", () => {
	it("parses a simple linear digraph", () => {
		const dot = `digraph {
      lint -> test -> build
    }`;
		const graph = parseDot(dot, "test-pipeline");
		expect(graph.name).toBe("test-pipeline");
		expect(graph.format).toBe("dot");
		expect(graph.nodes).toHaveLength(3);
		expect(graph.edges).toHaveLength(2);
		expect(graph.edges[0]).toEqual({ from: "lint", to: "test" });
		expect(graph.edges[1]).toEqual({ from: "test", to: "build" });
	});

	it("parses a named digraph", () => {
		const dot = `digraph "My Pipeline" {
      A -> B
    }`;
		const graph = parseDot(dot);
		expect(graph.name).toBe("My Pipeline");
	});

	it("parses node attributes (label, check)", () => {
		const dot = `digraph {
      lint [label="Lint Code" check="has-linter"]
      test [label="Run Tests" check="has-tests"]
      lint -> test
    }`;
		const graph = parseDot(dot);
		const lintNode = graph.nodes.find((n) => n.id === "lint");
		expect(lintNode?.label).toBe("Lint Code");
		expect(lintNode?.check).toBe("has-linter");
		const testNode = graph.nodes.find((n) => n.id === "test");
		expect(testNode?.label).toBe("Run Tests");
		expect(testNode?.check).toBe("has-tests");
	});

	it("parses edge labels", () => {
		const dot = `digraph {
      A -> B [label="on success"]
    }`;
		const graph = parseDot(dot);
		expect(graph.edges[0]?.label).toBe("on success");
	});

	it("parses branching (multiple edges)", () => {
		const dot = `digraph {
      lint -> test
      lint -> security
      test -> build
      security -> build
    }`;
		const graph = parseDot(dot);
		expect(graph.nodes).toHaveLength(4);
		expect(graph.edges).toHaveLength(4);
	});

	it("throws WorkflowParseError on missing digraph header", () => {
		expect(() => parseDot("graph { A -> B }")).toThrow(WorkflowParseError);
	});

	it("throws WorkflowParseError on empty digraph", () => {
		expect(() => parseDot("digraph { }")).toThrow(WorkflowParseError);
	});

	it("throws WorkflowParseError on malformed braces", () => {
		expect(() => parseDot("digraph { A -> B")).toThrow(WorkflowParseError);
	});

	it("ignores comments and graph-level attributes", () => {
		const dot = `digraph {
      rankdir=LR
      // this is a comment
      A -> B
    }`;
		const graph = parseDot(dot);
		expect(graph.nodes).toHaveLength(2);
	});

	it("handles semicolon-separated statements", () => {
		const dot = `digraph { A -> B; B -> C; }`;
		const graph = parseDot(dot);
		expect(graph.nodes).toHaveLength(3);
		expect(graph.edges).toHaveLength(2);
	});

	it("stores extra attributes as metadata", () => {
		const dot = `digraph {
      A [label="Node A" check="has-tests" shape="box"]
      A -> B
    }`;
		const graph = parseDot(dot);
		const nodeA = graph.nodes.find((n) => n.id === "A");
		expect(nodeA?.metadata).toEqual({ shape: "box" });
	});
});

describe("parseMermaid", () => {
	it("parses a simple flowchart", () => {
		const mermaid = `flowchart LR
  lint --> test --> build`;
		const graph = parseMermaid(mermaid, "test-flow");
		expect(graph.name).toBe("test-flow");
		expect(graph.format).toBe("mermaid");
		expect(graph.nodes).toHaveLength(3);
		expect(graph.edges).toHaveLength(2);
	});

	it("parses node labels in brackets", () => {
		const mermaid = `flowchart LR
  A[Lint Code] --> B[Run Tests]`;
		const graph = parseMermaid(mermaid);
		const nodeA = graph.nodes.find((n) => n.id === "A");
		expect(nodeA?.label).toBe("Lint Code");
		const nodeB = graph.nodes.find((n) => n.id === "B");
		expect(nodeB?.label).toBe("Run Tests");
	});

	it("parses edge labels", () => {
		const mermaid = `flowchart LR
  A -->|success| B`;
		const graph = parseMermaid(mermaid);
		expect(graph.edges[0]?.label).toBe("success");
	});

	it("accepts graph directive too", () => {
		const mermaid = `graph TD
  A --> B`;
		const graph = parseMermaid(mermaid);
		expect(graph.nodes).toHaveLength(2);
	});

	it("throws on empty file", () => {
		expect(() => parseMermaid("")).toThrow(WorkflowParseError);
	});

	it("throws on missing flowchart directive", () => {
		expect(() => parseMermaid("A --> B")).toThrow(WorkflowParseError);
	});

	it("ignores comments and style directives", () => {
		const mermaid = `flowchart LR
  %% this is a comment
  style A fill:#f9f
  classDef default fill:#f9f
  A --> B`;
		const graph = parseMermaid(mermaid);
		expect(graph.nodes).toHaveLength(2);
	});

	it("parses branching flows", () => {
		const mermaid = `flowchart LR
  A --> B
  A --> C
  B --> D
  C --> D`;
		const graph = parseMermaid(mermaid);
		expect(graph.nodes).toHaveLength(4);
		expect(graph.edges).toHaveLength(4);
	});
});
