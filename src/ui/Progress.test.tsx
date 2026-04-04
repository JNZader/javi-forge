import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { InitStep } from "../types/index.js";
import Progress from "./Progress.js";

/**
 * Progress — step-by-step display during scaffolding.
 *
 * Risk: if progress misrepresents step states, user can't tell
 * what succeeded vs failed during execution.
 */

function makeSteps(...statuses: InitStep["status"][]): InitStep[] {
	return statuses.map((status, i) => ({
		id: `step-${i}`,
		label: `Step ${i + 1}`,
		status,
	}));
}

describe("Progress", () => {
	it("renders all step labels", () => {
		const steps = makeSteps("done", "pending", "pending");
		const { lastFrame } = render(React.createElement(Progress, { steps }));

		const frame = lastFrame()!;
		expect(frame).toContain("Step 1");
		expect(frame).toContain("Step 2");
		expect(frame).toContain("Step 3");
	});

	it("shows progress count", () => {
		const steps = makeSteps("done", "done", "pending");
		const { lastFrame } = render(React.createElement(Progress, { steps }));

		expect(lastFrame()!).toContain("2/3 steps");
	});

	it("counts skipped steps as completed in progress", () => {
		const steps = makeSteps("done", "skipped", "pending");
		const { lastFrame } = render(React.createElement(Progress, { steps }));

		// done + skipped = 2 completed out of 3
		expect(lastFrame()!).toContain("2/3 steps");
	});

	it("shows context line when provided", () => {
		const steps = makeSteps("pending");
		const { lastFrame } = render(
			React.createElement(Progress, {
				steps,
				contextLine: "my-project (node)",
			}),
		);

		expect(lastFrame()!).toContain("my-project (node)");
	});

	it("shows step detail when present", () => {
		const steps: InitStep[] = [
			{ id: "a", label: "Setup", status: "done", detail: "created 3 files" },
		];
		const { lastFrame } = render(React.createElement(Progress, { steps }));

		const frame = lastFrame()!;
		expect(frame).toContain("Setup");
		expect(frame).toContain("created 3 files");
	});

	it("uses check mark for done steps", () => {
		const steps = makeSteps("done");
		const { lastFrame } = render(React.createElement(Progress, { steps }));

		// \u2713 = ✓
		expect(lastFrame()!).toContain("\u2713");
	});

	it("uses cross mark for error steps", () => {
		const steps = makeSteps("error");
		const { lastFrame } = render(React.createElement(Progress, { steps }));

		// \u2717 = ✗
		expect(lastFrame()!).toContain("\u2717");
	});

	it("uses dash for skipped steps", () => {
		const steps = makeSteps("skipped");
		const { lastFrame } = render(React.createElement(Progress, { steps }));

		// \u2013 = –
		expect(lastFrame()!).toContain("\u2013");
	});

	it("uses circle for pending steps", () => {
		const steps = makeSteps("pending");
		const { lastFrame } = render(React.createElement(Progress, { steps }));

		// \u25cb = ○
		expect(lastFrame()!).toContain("\u25cb");
	});

	it("calls onDone when all steps finish without errors", async () => {
		const onDone = vi.fn();
		const steps = makeSteps("done", "done", "skipped");

		render(React.createElement(Progress, { steps, onDone }));

		// onDone is called after a 600ms timeout
		await vi.waitFor(
			() => {
				expect(onDone).toHaveBeenCalledTimes(1);
			},
			{ timeout: 2000 },
		);
	});

	it("does NOT call onDone when there are errors", async () => {
		const onDone = vi.fn();
		const steps = makeSteps("done", "error");

		render(React.createElement(Progress, { steps, onDone }));

		// Wait a bit, onDone should NOT be called
		await new Promise((r) => setTimeout(r, 800));
		expect(onDone).not.toHaveBeenCalled();
	});

	it("does NOT call onDone when steps are still pending", async () => {
		const onDone = vi.fn();
		const steps = makeSteps("done", "pending");

		render(React.createElement(Progress, { steps, onDone }));

		await new Promise((r) => setTimeout(r, 800));
		expect(onDone).not.toHaveBeenCalled();
	});

	it("handles empty steps array without crashing", () => {
		const { lastFrame } = render(React.createElement(Progress, { steps: [] }));

		// Should render without error
		expect(lastFrame()).toBeDefined();
	});
});
