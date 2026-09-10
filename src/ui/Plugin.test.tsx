import { render } from "ink-testing-library";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import Plugin from "./Plugin.js";

vi.mock("../commands/plugin.js");

describe("Plugin presentation", () => {
	it.each([
		"success",
		"failure",
		"refused",
	] as const)("renders %s truthfully", (status) => {
		const view = render(
			createElement(Plugin, {
				action: "add",
				dryRun: true,
				steps: [{ id: "step", label: "Result detail", status: "done" }],
				result: { status },
			}),
		);
		try {
			expect(view.lastFrame()).toContain("Result detail");
			expect(view.lastFrame()).toContain(
				status === "success"
					? "Done."
					: status === "refused"
						? "Refused."
						: "Failed.",
			);
			if (status !== "success") expect(view.lastFrame()).not.toContain("Done.");
		} finally {
			view.unmount();
		}
	});
	it("shows no terminal success while still running", () => {
		const view = render(
			createElement(Plugin, {
				action: "list",
				dryRun: false,
				steps: [],
				result: null,
			}),
		);
		try {
			expect(view.lastFrame()).not.toContain("Done.");
		} finally {
			view.unmount();
		}
	});
});
