import { describe, expect, it } from "vitest";
import { PI_COMMAND_STATUS } from "../../commands/pi.js";
import { piCommandExitCode } from "./pi.js";

describe("pi CLI ownership", () => {
	it("maps command status without clearing prior failures", () => {
		expect(piCommandExitCode({ status: PI_COMMAND_STATUS.SUCCESS })).toBe(0);
		expect(piCommandExitCode({ status: PI_COMMAND_STATUS.FAILURE })).toBe(1);
		expect(piCommandExitCode({ status: PI_COMMAND_STATUS.SUCCESS }, 7)).toBe(7);
	});
});
