import { describe, expect, it } from "vitest";
import { unsupportedDoctorMessage } from "./Doctor.js";

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
