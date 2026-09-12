import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDoctor } from "../../commands/doctor.js";
import { CIProvider } from "../../ui/CIContext.js";
import DoctorController from "./doctor.js";

vi.mock("../../commands/doctor.js", () => ({ runDoctor: vi.fn() }));

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(runDoctor).mockResolvedValue({ state: "supported", sections: [] });
});
afterEach(() => vi.restoreAllMocks());

describe("DoctorController", () => {
	it("uses safe default options when rendered without props", async () => {
		const view = render(
			<CIProvider isCI={false}>
				<DoctorController />
			</CIProvider>,
		);
		try {
			await vi.waitFor(() =>
				expect(runDoctor).toHaveBeenCalledWith(undefined, {
					dryRun: false,
					refreshContext: false,
				}),
			);
		} finally {
			view.unmount();
		}
	});

	it.each([
		false,
		true,
	])("forwards refresh and dry-run=%s on initial collection and rerun", async (dryRun) => {
		const view = render(
			<CIProvider isCI={false}>
				<DoctorController dryRun={dryRun} refreshContext={true} />
			</CIProvider>,
		);
		try {
			await vi.waitFor(() =>
				expect(runDoctor).toHaveBeenCalledWith(undefined, {
					dryRun,
					refreshContext: true,
				}),
			);
			view.stdin.write("r");
			await vi.waitFor(() => expect(runDoctor).toHaveBeenCalledTimes(2));
			expect(runDoctor).toHaveBeenLastCalledWith(undefined, {
				dryRun,
				refreshContext: true,
			});
		} finally {
			view.unmount();
		}
	});
});
