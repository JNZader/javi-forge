import { describe, expect, it } from "vitest";
import {
	type ApprovalPort,
	bindPreparation,
	inspectAuthorization,
	OUTPUTS,
	POLICY,
} from "./preparation-capability.js";

const digest = "a".repeat(64);
function request() {
	return {
		cwd: POLICY.cwd,
		destination: POLICY.destination,
		args: [],
		env: {},
		stdin: "",
		importPaths: [],
		identities: {
			code: digest,
			dependencies: digest,
			executable: digest,
			config: digest,
			destination: digest,
		},
		outputs: Object.fromEntries(OUTPUTS.map((name) => [name, "inert fixture"])),
		entrypoint: "fixed-local-mock-tests",
	};
}
describe("preparation binding and runtime readiness", () => {
	it("snapshots exact inert payload and fixed limits", () => {
		const input = request();
		const bound = bindPreparation(input);
		input.outputs[OUTPUTS[0]] = "changed";
		expect(bound.outputs[OUTPUTS[0]]).toBe("inert fixture");
		expect(Object.isFrozen(bound.outputs)).toBe(true);
		expect(bound.policy.maxBytes).toBe(1048576);
	});
	it.each([
		"code",
		"dependencies",
		"executable",
		"config",
		"destination",
	] as const)("binds %s identity", (key) => {
		const input = request();
		const before = bindPreparation(input).binding;
		input.identities[key] = "b".repeat(64);
		expect(bindPreparation(input).binding).not.toBe(before);
	});
	it.each([
		(r: ReturnType<typeof request>) => {
			r.cwd += "/wrong";
		},
		(r: ReturnType<typeof request>) => {
			r.destination += "/other";
		},
		(r: ReturnType<typeof request>) => {
			Object.assign(r, { args: ["code"] });
		},
		(r: ReturnType<typeof request>) => {
			Object.assign(r.env, { SECRET: "private" });
		},
		(r: ReturnType<typeof request>) => {
			r.stdin = "code";
		},
		(r: ReturnType<typeof request>) => {
			Object.assign(r, { importPaths: ["/tmp"] });
		},
		(r: ReturnType<typeof request>) => {
			r.outputs["../escape"] = "x";
		},
		(r: ReturnType<typeof request>) => {
			r.identities.code = "invalid";
		},
		(r: ReturnType<typeof request>) => {
			r.outputs[OUTPUTS[0]] = "x".repeat(1048576);
		},
		(r: ReturnType<typeof request>) => {
			r.entrypoint = "python-body";
		},
	])("rejects contract deviation %s", (change) => {
		const input = request();
		change(input);
		expect(() => bindPreparation(input)).toThrow("invalid-contract");
	});
	it("denies absent production authority with sanitized result", async () => {
		expect(
			await inspectAuthorization(bindPreparation(request()), "SECRET", 1000),
		).toEqual({ status: "authorization-unavailable" });
	});
	it("does not consume approval while full runtime is unavailable", async () => {
		let calls = 0;
		const port: ApprovalPort = {
			async verify() {
				calls++;
				return undefined;
			},
		};
		expect(
			await inspectAuthorization(
				bindPreparation(request()),
				"fixture",
				1000,
				port,
			),
		).toEqual({ status: "runtime-unavailable" });
		expect(calls).toBe(0);
	});
	it.each([
		-1,
		NaN,
		Infinity,
	])("rejects invalid clock %s before authority contact", async (now) => {
		const port: ApprovalPort = {
			async verify() {
				throw new Error("must not call");
			},
		};
		expect(
			(
				await inspectAuthorization(
					bindPreparation(request()),
					"fixture",
					now,
					port,
				)
			).status,
		).toBe("authorization-denied");
	});
});
