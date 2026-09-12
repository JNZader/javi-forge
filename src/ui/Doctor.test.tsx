import { render } from "ink-testing-library";
import { createElement, default as React } from "react";
import { describe, expect, it, vi } from "vitest";
import { CIProvider } from "./CIContext.js";
import Doctor, { unsupportedDoctorMessage } from "./Doctor.js";

describe("Doctor unsupported-platform UI state", () => {
	it("labels rerun as rerunning checks", () => {
		const view = render(
			<CIProvider isCI={false}>
				{createElement(Doctor, {
					loading: false,
					result: { state: "supported", sections: [] },
					error: null,
					onRerun: vi.fn(),
				})}
			</CIProvider>,
		);
		try {
			expect(view.lastFrame()).toContain("Press r to rerun checks, q to quit");
		} finally {
			view.unmount();
		}
	});

	it("renders generic supported-host guidance without collecting", () => {
		const onRerun = vi.fn();
		const view = render(
			<CIProvider isCI={false}>
				{createElement(Doctor, {
					loading: false,
					result: {
						state: "unsupported-platform",
						guidance: "javi-forge supports Linux and Windows only.",
						sections: [],
					},
					error: null,
					onRerun,
				})}
			</CIProvider>,
		);
		try {
			expect(
				unsupportedDoctorMessage({
					state: "unsupported-platform",
					guidance: "javi-forge supports Linux and Windows only.",
					sections: [],
				}),
			).toBe(
				"unsupported-platform: javi-forge supports Linux and Windows only.",
			);
			expect(view.lastFrame()).toContain(
				"unsupported-platform: javi-forge supports Linux and Windows only.",
			);
			view.stdin.write("r");
			expect(onRerun).toHaveBeenCalledExactlyOnceWith();
		} finally {
			view.unmount();
		}
	});
});
