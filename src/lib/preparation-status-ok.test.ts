import { describe, expect, it, vi } from "vitest";
import {
	dispatchStatusOkMock,
	parseStatusOk,
} from "./preparation-status-ok.js";

function fixture() {
	return {
		info: {
			id: "msg_mock",
			role: "assistant",
			sessionID: "ses_mock",
			providerID: "opencode",
			modelID: "mimo-v2.5-free",
			structured: { status: "ok" },
		},
		parts: [
			{
				type: "tool",
				tool: "StructuredOutput",
				sessionID: "ses_mock",
				messageID: "msg_mock",
				state: { status: "completed", input: { status: "ok" } },
			},
		],
	};
}
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
describe("status-ok preparation semantics (mock only)", () => {
	it("accepts exact native capture", () =>
		expect(parseStatusOk(bytes(fixture()), "ses_mock")).toEqual({
			status: "ok",
		}));
	it.each([
		"null",
		"[]",
		"{}",
		"```json {} ```",
		"{",
		'{"a":1,"a":2}',
		'{"a":1,"\\u0061":2}',
		'{"x":[{"a":1,"a":2}]}',
		"[1,]",
		'"unterminated',
		"1e999",
	])("rejects invalid envelope %s", (raw) =>
		expect(() => parseStatusOk(Buffer.from(raw), "ses_mock")).toThrow());
	it.each([
		Buffer.from([0xff]),
		Buffer.alloc(1048577, 32),
		Buffer.from(`${"[".repeat(66)}0${"]".repeat(66)}`),
	])("rejects encoding/size/depth", (raw) =>
		expect(() => parseStatusOk(raw, "ses_mock")).toThrow());
	it.each([
		(v: ReturnType<typeof fixture>) => {
			v.info.role = "user";
		},
		(v: ReturnType<typeof fixture>) => {
			v.info.sessionID = "other";
		},
		(v: ReturnType<typeof fixture>) => {
			v.info.providerID = "other";
		},
		(v: ReturnType<typeof fixture>) => {
			v.info.modelID = "other";
		},
		(v: ReturnType<typeof fixture>) => {
			Object.assign(v.info, { error: null });
		},
		(v: ReturnType<typeof fixture>) => {
			Object.assign(v.info, { structured: { status: "ok", extra: true } });
		},
		(v: ReturnType<typeof fixture>) => {
			v.info.structured.status = "no";
		},
		(v: ReturnType<typeof fixture>) => {
			Object.assign(v.info, { structured: null });
		},
		(v: ReturnType<typeof fixture>) => {
			Object.assign(v, { parts: null });
		},
		(v: ReturnType<typeof fixture>) => {
			Object.assign(v, { parts: [null] });
		},
		(v: ReturnType<typeof fixture>) => {
			v.parts = [];
		},
		(v: ReturnType<typeof fixture>) => {
			v.parts.push(v.parts[0]!);
		},
		(v: ReturnType<typeof fixture>) => {
			v.parts[0]!.tool = "bash";
		},
		(v: ReturnType<typeof fixture>) => {
			v.parts[0]!.sessionID = "other";
		},
		(v: ReturnType<typeof fixture>) => {
			v.parts[0]!.messageID = "other";
		},
		(v: ReturnType<typeof fixture>) => {
			v.parts[0]!.state.status = "running";
		},
		(v: ReturnType<typeof fixture>) => {
			v.parts[0]!.state.input.status = "no";
		},
		(v: ReturnType<typeof fixture>) => {
			Object.assign(v.parts[0]!.state, { input: { status: "ok", extra: 1 } });
		},
	])("rejects identity/capture mutation %#", (mutate) => {
		const v = fixture();
		mutate(v);
		expect(() => parseStatusOk(bytes(v), "ses_mock")).toThrow();
	});
	it("rejects decoded duplicate in an otherwise valid response", () => {
		const raw = JSON.stringify(fixture()).replace(
			'"status":"ok"',
			'"status":"ok","sta\\u0074us":"ok"',
		);
		expect(() => parseStatusOk(Buffer.from(raw), "ses_mock")).toThrow();
	});
	it("dispatches exactly one fixed mock message", async () => {
		const send = vi.fn(async () => bytes(fixture()));
		await expect(dispatchStatusOkMock("ses_mock", send)).resolves.toEqual({
			status: "ok",
		});
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0]).toEqual([
			"ses_mock",
			{
				model: { providerID: "opencode", modelID: "mimo-v2.5-free" },
				format: {
					type: "json_schema",
					schema: {
						type: "object",
						properties: { status: { const: "ok" } },
						required: ["status"],
						additionalProperties: false,
					},
					retryCount: 0,
				},
				parts: [
					{
						type: "text",
						text: 'Return exactly {"status":"ok"} using StructuredOutput.',
					},
				],
			},
		]);
	});
	it("never retries failed mock transport", async () => {
		const send = vi.fn(async () => {
			throw new Error("fixture failure");
		});
		await expect(dispatchStatusOkMock("ses_mock", send)).rejects.toThrow();
		expect(send).toHaveBeenCalledTimes(1);
	});
	it("never retries invalid capture", async () => {
		const send = vi.fn(async () => Buffer.from("{}"));
		await expect(dispatchStatusOkMock("ses_mock", send)).rejects.toThrow();
		expect(send).toHaveBeenCalledTimes(1);
	});
	it("rejects invalid session before dispatch", async () => {
		const send = vi.fn();
		await expect(dispatchStatusOkMock("", send)).rejects.toThrow();
		expect(send).not.toHaveBeenCalled();
	});
});
