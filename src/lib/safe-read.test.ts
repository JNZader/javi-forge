import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINE_LENGTH,
	describeSafeReadFailure,
	safeReadFile,
} from "./safe-read.js";

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-safe-read-"));
});

afterEach(async () => {
	await fs.remove(tmpDir);
});

async function writeFixture(
	name: string,
	data: string | Buffer,
): Promise<string> {
	const filePath = path.join(tmpDir, name);
	await fs.writeFile(filePath, data);
	return filePath;
}

// =============================================================================
// Happy path
// =============================================================================

describe("safeReadFile — normal reads", () => {
	it("reads a small text file whole", async () => {
		const filePath = await writeFixture("hello.md", "# Title\n\nbody\n");

		const result = await safeReadFile(filePath);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.content).toBe("# Title\n\nbody\n");
		expect(result.truncated).toBe(false);
		expect(result.longLinesClamped).toBe(false);
		expect(result.bytesRead).toBe(14);
		expect(result.totalBytes).toBe(14);
	});

	it("reads an empty file", async () => {
		const filePath = await writeFixture("empty.md", "");

		const result = await safeReadFile(filePath);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.content).toBe("");
		expect(result.truncated).toBe(false);
		expect(result.bytesRead).toBe(0);
		expect(result.totalBytes).toBe(0);
	});

	it("strips a UTF-8 BOM", async () => {
		const filePath = await writeFixture("bom.md", "﻿---\nname: x\n");

		const result = await safeReadFile(filePath);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.content.startsWith("---")).toBe(true);
	});

	it("preserves CRLF verbatim", async () => {
		const filePath = await writeFixture("crlf.md", "a\r\nb\r\n");

		const result = await safeReadFile(filePath);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.content).toBe("a\r\nb\r\n");
	});

	it("reads files larger than one internal chunk", async () => {
		const body = "x".repeat(200_000);
		const filePath = await writeFixture("big-but-ok.txt", body);

		const result = await safeReadFile(filePath, { maxLineLength: 0 });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.truncated).toBe(false);
		expect(result.content.length).toBe(200_000);
	});
});

// =============================================================================
// Byte cap
// =============================================================================

describe("safeReadFile — byte cap", () => {
	it("truncates at the byte budget and reports it", async () => {
		const filePath = await writeFixture("long.txt", "abcdefghij");

		const result = await safeReadFile(filePath, { maxBytes: 4 });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.content).toBe("abcd");
		expect(result.truncated).toBe(true);
		expect(result.bytesRead).toBe(4);
		expect(result.totalBytes).toBe(10);
	});

	it("does not report truncation when the budget matches the file exactly", async () => {
		const filePath = await writeFixture("exact.txt", "abcd");

		const result = await safeReadFile(filePath, { maxBytes: 4 });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.truncated).toBe(false);
		expect(result.content).toBe("abcd");
	});

	it("never splits a multi-byte codepoint at the cap", async () => {
		// "é" is 2 bytes (C3 A9); cutting at 3 bytes lands mid-sequence.
		const filePath = await writeFixture("utf8.txt", "aéé");
		expect(Buffer.byteLength("aéé", "utf-8")).toBe(5);

		const result = await safeReadFile(filePath, { maxBytes: 4 });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.content).toBe("aé");
		expect(result.content).not.toContain("�");
		expect(result.bytesRead).toBe(3);
		expect(result.truncated).toBe(true);
	});

	it("never splits a 4-byte emoji at the cap", async () => {
		const filePath = await writeFixture("emoji.txt", "ab🙂🙂");

		const result = await safeReadFile(filePath, { maxBytes: 8 });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.content).toBe("ab🙂");
		expect(result.content).not.toContain("�");
	});

	it("rejects instead of truncating when hardRejectOverBytes is set", async () => {
		const filePath = await writeFixture("huge.txt", "abcdefghij");

		const result = await safeReadFile(filePath, { hardRejectOverBytes: 4 });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("too-large");
		expect(result.detail).toContain("10 bytes");
	});

	it("accepts a file at exactly hardRejectOverBytes", async () => {
		const filePath = await writeFixture("edge.txt", "abcd");

		const result = await safeReadFile(filePath, { hardRejectOverBytes: 4 });

		expect(result.ok).toBe(true);
	});
});

// =============================================================================
// Line clamp
// =============================================================================

describe("safeReadFile — line clamp", () => {
	it("clamps a single pathological line and marks the drop", async () => {
		const filePath = await writeFixture(
			"minified.js",
			`short\n${"y".repeat(50)}\nshort\n`,
		);

		const result = await safeReadFile(filePath, { maxLineLength: 10 });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.longLinesClamped).toBe(true);
		const lines = result.content.split("\n");
		expect(lines[0]).toBe("short");
		expect(lines[1]).toBe(`${"y".repeat(10)}…[clamped 40 chars]`);
		expect(lines[2]).toBe("short");
	});

	it("leaves short lines untouched", async () => {
		const filePath = await writeFixture("short.md", "one\ntwo\nthree\n");

		const result = await safeReadFile(filePath, { maxLineLength: 10 });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.longLinesClamped).toBe(false);
		expect(result.content).toBe("one\ntwo\nthree\n");
	});

	it("disables the clamp when maxLineLength is 0", async () => {
		const filePath = await writeFixture("wide.txt", "z".repeat(200));

		const result = await safeReadFile(filePath, { maxLineLength: 0 });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.longLinesClamped).toBe(false);
		expect(result.content.length).toBe(200);
	});
});

// =============================================================================
// Failure modes
// =============================================================================

describe("safeReadFile — failures", () => {
	it("detects binary content by NUL byte, not extension", async () => {
		const filePath = await writeFixture(
			"looks-like.md",
			Buffer.from([0x23, 0x20, 0x68, 0x69, 0x00, 0x01, 0x02]),
		);

		const result = await safeReadFile(filePath);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("binary");
	});

	it("returns not-found for a missing file", async () => {
		const result = await safeReadFile(path.join(tmpDir, "nope.md"));

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("not-found");
	});

	it("returns not-found when a path component is not a directory", async () => {
		const filePath = await writeFixture("file.txt", "x");

		const result = await safeReadFile(path.join(filePath, "child.txt"));

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("not-found");
	});

	it("returns not-a-file for a directory", async () => {
		const dirPath = path.join(tmpDir, "adir");
		await fs.ensureDir(dirPath);

		const result = await safeReadFile(dirPath);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("not-a-file");
		expect(result.detail).toContain("directory");
	});
});

// =============================================================================
// Defaults + helpers
// =============================================================================

describe("safe-read defaults and helpers", () => {
	it("exposes the documented defaults", () => {
		expect(DEFAULT_MAX_BYTES).toBe(1024 * 1024);
		expect(DEFAULT_MAX_LINE_LENGTH).toBe(10_000);
	});

	it("describes every failure reason", () => {
		expect(describeSafeReadFailure({ ok: false, reason: "not-found" })).toBe(
			"file not found",
		);
		expect(describeSafeReadFailure({ ok: false, reason: "binary" })).toBe(
			"binary file",
		);
		expect(
			describeSafeReadFailure({ ok: false, reason: "not-a-file" }),
		).toContain("regular file");
		expect(describeSafeReadFailure({ ok: false, reason: "too-large" })).toBe(
			"too large",
		);
		expect(
			describeSafeReadFailure({
				ok: false,
				reason: "io-error",
				detail: "EACCES",
			}),
		).toBe("read error: EACCES");
	});
});
