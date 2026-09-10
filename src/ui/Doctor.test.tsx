import { render } from "ink-testing-library";
import { createElement, default as React } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DoctorOptions, runDoctor } from "../commands/doctor.js";
import { CIProvider } from "./CIContext.js";
import Doctor, { unsupportedDoctorMessage } from "./Doctor.js";

vi.mock("../commands/doctor.js", () => ({ runDoctor: vi.fn() }));
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(runDoctor).mockResolvedValue({ state: "supported", sections: [] });
});
afterEach(() => vi.restoreAllMocks());

describe("Doctor unsupported-platform UI state", () => {
	it("uses only generic supported-host guidance", () => {
		expect(
			unsupportedDoctorMessage({
				state: "unsupported-platform",
				guidance: "javi-forge supports Linux and Windows only.",
				sections: [],
			}),
		).toBe("unsupported-platform: javi-forge supports Linux and Windows only.");
	});
});

describe("Doctor option forwarding", () => {
	it.each([
		false,
		true,
	])("forwards refresh intent without losing dryRun=%s", async (dryRun) => {
		const view = render(
			<CIProvider isCI={false}>
				{createElement<DoctorOptions>(Doctor, {
					dryRun,
					refreshContext: true,
				})}
			</CIProvider>,
		);
		try {
			await vi.waitFor(() =>
				expect(runDoctor).toHaveBeenCalledWith(undefined, {
					dryRun,
					refreshContext: true,
				}),
			);
		} finally {
			view.unmount();
		}
	});
});
