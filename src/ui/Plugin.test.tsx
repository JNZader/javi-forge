import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import Plugin from "./Plugin.js";

describe("Plugin presentation", () => {
	it("renders command progress and success status without running commands", () => {
		const view = render(
			React.createElement(Plugin, {
				action: "search",
				dryRun: false,
				steps: [
					{
						id: "plugin-search",
						label: "Search plugins: coder",
						status: "done",
						detail: "1 results",
					},
				],
				result: { status: "success" },
			}),
		);

		expect(view.lastFrame()).toContain("plugin search");
		expect(view.lastFrame()).toContain("Search plugins: coder");
		expect(view.lastFrame()).toContain("1 results");
		expect(view.lastFrame()).toContain("Done.");
	});

	it("distinguishes refused and failed outcomes", () => {
		const refused = render(
			React.createElement(Plugin, {
				action: "add",
				dryRun: true,
				steps: [],
				result: { status: "refused" },
			}),
		);
		const failed = render(
			React.createElement(Plugin, {
				action: "validate",
				dryRun: false,
				steps: [],
				result: { status: "failure" },
			}),
		);

		expect(refused.lastFrame()).toContain("Refused.");
		expect(refused.lastFrame()).toContain("(dry-run)");
		expect(failed.lastFrame()).toContain("Failed.");
	});
});
