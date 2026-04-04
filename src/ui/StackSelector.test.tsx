import { render } from "ink-testing-library";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CIProvider } from "./CIContext.js";
import StackSelector from "./StackSelector.js";

/**
 * StackSelector — single-select for project stack with auto-detection.
 *
 * Risk: wrong stack selection drives wrong CLAUDE.md content,
 * context files, and install hints. Critical for correct scaffolding.
 */

// Mock detectStack to avoid filesystem reads during tests
vi.mock("../lib/common.js", () => ({
	detectStack: vi.fn().mockResolvedValue(null),
	STACK_LABELS: {
		node: "Node.js",
		python: "Python",
		go: "Go",
		rust: "Rust",
		"java-gradle": "Java (Gradle)",
		"java-maven": "Java (Maven)",
		elixir: "Elixir",
	},
}));

function renderWithCI(ui: React.ReactElement, isCI = false) {
	return render(React.createElement(CIProvider, { isCI }, ui));
}

describe("StackSelector", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows detecting message initially then stack list", async () => {
		const onConfirm = vi.fn();
		const { lastFrame } = renderWithCI(
			React.createElement(StackSelector, {
				projectDir: "/tmp/test",
				onConfirm,
			}),
		);

		// After detection resolves (null = no detection), should show stack list
		await vi.waitFor(() => {
			const frame = lastFrame()!;
			expect(frame).toContain("Select project stack");
		});
	});

	it("renders all stack options after detection", async () => {
		const onConfirm = vi.fn();
		const { lastFrame } = renderWithCI(
			React.createElement(StackSelector, {
				projectDir: "/tmp/test",
				onConfirm,
			}),
		);

		await vi.waitFor(() => {
			const frame = lastFrame()!;
			expect(frame).toContain("Node.js");
			expect(frame).toContain("Python");
			expect(frame).toContain("Go");
			expect(frame).toContain("Rust");
			expect(frame).toContain("Java (Gradle)");
			expect(frame).toContain("Java (Maven)");
			expect(frame).toContain("Elixir");
		});
	});

	it("shows navigation hint", async () => {
		const onConfirm = vi.fn();
		const { lastFrame } = renderWithCI(
			React.createElement(StackSelector, {
				projectDir: "/tmp/test",
				onConfirm,
			}),
		);

		await vi.waitFor(() => {
			const frame = lastFrame()!;
			expect(frame).toContain("navigate");
			expect(frame).toContain("confirm");
		});
	});

	it("shows auto-detected label when stack is detected", async () => {
		const { detectStack } = await import("../lib/common.js");
		vi.mocked(detectStack).mockResolvedValue({
			stackType: "python",
			buildTool: "pip",
		});

		const onConfirm = vi.fn();
		const { lastFrame } = renderWithCI(
			React.createElement(StackSelector, {
				projectDir: "/tmp/test",
				onConfirm,
			}),
		);

		await vi.waitFor(() => {
			const frame = lastFrame()!;
			expect(frame).toContain("Auto-detected");
		});
	});

	it("auto-confirms detected stack in CI mode", async () => {
		const { detectStack } = await import("../lib/common.js");
		vi.mocked(detectStack).mockResolvedValue({
			stackType: "node",
			buildTool: "pnpm",
		});

		const onConfirm = vi.fn();
		renderWithCI(
			React.createElement(StackSelector, {
				projectDir: "/tmp/test",
				onConfirm,
			}),
			true,
		);

		await vi.waitFor(() => {
			expect(onConfirm).toHaveBeenCalledTimes(1);
		});

		// Detected node → cursor moves to node index (0) → confirms 'node'
		expect(onConfirm).toHaveBeenCalledWith("node");
	});

	it("confirms on Enter keypress", async () => {
		const onConfirm = vi.fn();
		const { stdin, lastFrame } = renderWithCI(
			React.createElement(StackSelector, {
				projectDir: "/tmp/test",
				onConfirm,
			}),
		);

		// Wait for detection to finish
		await vi.waitFor(() => {
			expect(lastFrame()!).toContain("Select project stack");
		});

		stdin.write("\r");

		await vi.waitFor(() => {
			expect(onConfirm).toHaveBeenCalledTimes(1);
		});

		// Default cursor is at 0 → 'node'
		expect(onConfirm).toHaveBeenCalledWith("node");
	});
});
