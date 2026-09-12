import {
	lstatSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OUTPUTS } from "./preparation-capability.js";
import { createFixtureStager } from "./preparation-stager.js";

const fixtures: ReturnType<typeof createFixtureStager>[] = [];
function fixture() {
	const f = createFixtureStager();
	fixtures.push(f);
	return f;
}
const outputs = () =>
	Object.fromEntries(
		OUTPUTS.map((n) => [n, n.endsWith(".json") ? "{}" : "# dormant fixture\n"]),
	);
afterEach(() => {
	for (const f of fixtures.splice(0)) f.dispose();
});
describe("descriptor anchored data-only stager", () => {
	it("creates exactly six immutable payload files with restrictive modes", () => {
		const f = fixture();
		const input = outputs();
		const destination = f.stage(input);
		expect(readdirSync(destination).sort()).toEqual([...OUTPUTS].sort());
		expect(lstatSync(destination).mode & 0o777).toBe(0o700);
		for (const name of OUTPUTS) {
			expect(lstatSync(path.join(destination, name)).mode & 0o777).toBe(0o600);
			expect(readFileSync(path.join(destination, name), "utf8")).toBe(
				input[name],
			);
		}
		expect(() => f.stage(input)).toThrow("staging-denied");
	});
	it("rejects symlink destinations and does not write through them", () => {
		const f = fixture();
		symlinkSync(f.root, path.join(f.root, "attempt-3"));
		expect(() => f.stage(outputs())).toThrow("staging-denied");
		expect(readdirSync(f.root)).toEqual(["attempt-3"]);
	});
	it("rejects an ancestor replacement without following the replacement", () => {
		const f = fixture();
		const moved = `${f.root}-moved`;
		renameSync(f.root, moved);
		symlinkSync(moved, f.root);
		try {
			expect(() => f.stage(outputs())).toThrow("staging-denied");
			expect(readdirSync(moved)).toEqual([]);
		} finally {
			rmSync(f.root);
			renameSync(moved, f.root);
		}
	});
	it.each([
		"../escape",
		"extra",
	])("rejects extra name %s without creating destination", (name) => {
		const f = fixture();
		expect(() => f.stage({ ...outputs(), [name]: "secret" })).toThrow(
			"staging-denied",
		);
		expect(readdirSync(f.root)).toEqual([]);
	});
	it("rejects byte overflow", () => {
		const f = fixture();
		const input = outputs();
		input[OUTPUTS[0]] = "x".repeat(1048577);
		expect(() => f.stage(input)).toThrow("staging-denied");
		expect(readdirSync(f.root)).toEqual([]);
	});
	it("does not overwrite an existing regular destination", () => {
		const f = fixture();
		writeFileSync(path.join(f.root, "attempt-3"), "untouched");
		expect(() => f.stage(outputs())).toThrow("staging-denied");
		expect(readFileSync(path.join(f.root, "attempt-3"), "utf8")).toBe(
			"untouched",
		);
	});
});

// Only disk-error/race injection is mocked; descriptors, files and cleanup are real.
import { vi } from "vitest";

const disk = vi.hoisted(() => ({
	failAt: 0,
	calls: 0,
	beforeWrite: undefined as (() => void) | undefined,
}));
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		writeSync(fd: number, buffer: Buffer, offset: number, length: number) {
			disk.calls++;
			const before = disk.beforeWrite;
			disk.beforeWrite = undefined;
			before?.();
			if (disk.failAt === disk.calls)
				throw new Error("fixture-disk-error SECRET");
			return actual.writeSync(fd, buffer, offset, length);
		},
	};
});
afterEach(() => {
	disk.failAt = 0;
	disk.calls = 0;
	disk.beforeWrite = undefined;
});
it("cleans only its own partial files after a disk write failure", () => {
	const f = fixture();
	disk.failAt = 3;
	expect(() => f.stage(outputs())).toThrow("staging-denied");
	expect(readdirSync(f.root)).toEqual([]);
});
it("pins writes and cleanup during a mid-write ancestor swap", () => {
	const f = fixture();
	const other = fixture();
	const moved = `${f.root}-moved`;
	disk.beforeWrite = () => {
		renameSync(f.root, moved);
		symlinkSync(other.root, f.root);
	};
	try {
		expect(() => f.stage(outputs())).toThrow("staging-denied");
		expect(readdirSync(other.root)).toEqual([]);
		expect(readdirSync(moved)).toEqual([]);
	} finally {
		rmSync(f.root);
		renameSync(moved, f.root);
	}
});
