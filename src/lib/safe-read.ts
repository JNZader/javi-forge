/**
 * Bounded, non-throwing file reads.
 *
 * Every whole-file read in this CLI used to be an unguarded
 * `fs.readFile(path, "utf-8")`: a 400 MB log, a minified bundle or a binary
 * blob under a scanned directory could exhaust memory or stall a scan. This
 * module is the single guarded entry point — it caps bytes during the read,
 * rejects binaries by content sniffing, clamps pathological single lines, and
 * returns a discriminated union instead of throwing for expected conditions.
 *
 * Deliberately NOT included: no path allow/block list. This is a local CLI
 * operating on the user's own repository, so any path they can name they can
 * already `cat`; a blocklist would add friction without adding a boundary.
 */

import { open, stat } from "node:fs/promises";

// =============================================================================
// Constants
// =============================================================================

/** Default byte budget for a single read (1 MiB). */
export const DEFAULT_MAX_BYTES = 1024 * 1024;

/** Default per-line character clamp — catches minified bundles and data URIs. */
export const DEFAULT_MAX_LINE_LENGTH = 10_000;

/** Size of each read from the file handle. */
const READ_CHUNK_BYTES = 64 * 1024;

/** Bytes of the first chunk sniffed for NUL when classifying binary content. */
const BINARY_SNIFF_BYTES = 8 * 1024;

const BOM = "\uFEFF";

// =============================================================================
// Types
// =============================================================================

export interface SafeReadOptions {
	/** Maximum bytes kept. Anything beyond is dropped and `truncated` is set. */
	maxBytes?: number;
	/** Per-line character clamp. Use `0` or `Infinity` to disable. */
	maxLineLength?: number;
	/**
	 * If the file is larger than this, fail with `too-large` instead of
	 * truncating. Off by default — truncation is the normal behavior.
	 */
	hardRejectOverBytes?: number;
}

export type SafeReadFailureReason =
	| "not-found"
	| "not-a-file"
	| "binary"
	| "too-large"
	| "io-error";

export interface SafeReadSuccess {
	ok: true;
	content: string;
	/** True when the file had more bytes than the budget allowed. */
	truncated: boolean;
	/** Bytes actually decoded into `content` (before BOM stripping). */
	bytesRead: number;
	/** File size reported by `stat` at the time of the read. */
	totalBytes: number;
	/** True when at least one line hit the per-line clamp. */
	longLinesClamped: boolean;
}

export interface SafeReadFailure {
	ok: false;
	reason: SafeReadFailureReason;
	detail?: string;
}

export type SafeReadResult = SafeReadSuccess | SafeReadFailure;

// =============================================================================
// Internal helpers
// =============================================================================

function errnoOf(err: unknown): string | undefined {
	return typeof err === "object" && err !== null && "code" in err
		? String((err as { code: unknown }).code)
		: undefined;
}

function messageOf(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * Drop a trailing partial UTF-8 sequence so a byte-capped buffer never decodes
 * into a replacement character. Scans back at most 3 bytes (max lead distance
 * for a 4-byte sequence) looking for a lead byte whose sequence would run past
 * the end of the buffer.
 */
function trimPartialUtf8(buf: Buffer): Buffer<ArrayBufferLike> {
	const maxLookback = Math.min(3, buf.length);
	for (let back = 0; back < maxLookback; back++) {
		const index = buf.length - 1 - back;
		const byte = buf[index] as number;
		// Continuation byte (10xxxxxx): keep walking back to its lead byte.
		if ((byte & 0xc0) === 0x80) continue;
		// ASCII byte: the buffer ends on a complete codepoint.
		if ((byte & 0x80) === 0) return buf;
		// Lead byte: does its full sequence fit in what we kept?
		let needed = 0;
		if ((byte & 0xe0) === 0xc0) needed = 2;
		else if ((byte & 0xf0) === 0xe0) needed = 3;
		else if ((byte & 0xf8) === 0xf0) needed = 4;
		else return buf; // invalid lead byte — leave it to the decoder
		const available = buf.length - index;
		return available >= needed ? buf : buf.subarray(0, index);
	}
	return buf;
}

/** Clamp lines longer than `maxLineLength`, marking how much was dropped. */
function clampLongLines(
	content: string,
	maxLineLength: number,
): { content: string; clamped: boolean } {
	if (!Number.isFinite(maxLineLength) || maxLineLength <= 0) {
		return { content, clamped: false };
	}
	if (content.length <= maxLineLength) return { content, clamped: false };

	const lines = content.split("\n");
	let clamped = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] as string;
		if (line.length <= maxLineLength) continue;
		const dropped = line.length - maxLineLength;
		lines[i] = `${line.slice(0, maxLineLength)}…[clamped ${dropped} chars]`;
		clamped = true;
	}

	return clamped
		? { content: lines.join("\n"), clamped }
		: { content, clamped };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Read a text file with a byte budget, binary rejection and line clamping.
 *
 * Never throws for expected conditions (missing file, directory, binary,
 * oversized, permission denied) — inspect `result.ok` and branch on `reason`.
 *
 * Newlines are returned verbatim: CRLF is NOT normalized, because the callers
 * migrated to this helper already tolerate `\r` (they `trim()` split lines) and
 * silently rewriting bytes would make reported offsets diverge from the file.
 */
export async function safeReadFile(
	filePath: string,
	opts: SafeReadOptions = {},
): Promise<SafeReadResult> {
	const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
	const maxLineLength = opts.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
	const hardRejectOverBytes = opts.hardRejectOverBytes;

	// -- Stat first: classify directories, sockets and missing paths cheaply ---
	let totalBytes: number;
	try {
		const stats = await stat(filePath);
		if (!stats.isFile()) {
			return {
				ok: false,
				reason: "not-a-file",
				detail: stats.isDirectory()
					? "path is a directory"
					: "not a regular file",
			};
		}
		totalBytes = stats.size;
	} catch (err) {
		const code = errnoOf(err);
		if (code === "ENOENT" || code === "ENOTDIR") {
			return { ok: false, reason: "not-found", detail: filePath };
		}
		return { ok: false, reason: "io-error", detail: messageOf(err) };
	}

	if (hardRejectOverBytes !== undefined && totalBytes > hardRejectOverBytes) {
		return {
			ok: false,
			reason: "too-large",
			detail: `${totalBytes} bytes exceeds limit of ${hardRejectOverBytes}`,
		};
	}

	if (maxBytes <= 0) {
		return {
			ok: true,
			content: "",
			truncated: totalBytes > 0,
			bytesRead: 0,
			totalBytes,
			longLinesClamped: false,
		};
	}

	// -- Read in chunks, enforcing the budget as we go (never buffer it all) ---
	const chunks: Buffer[] = [];
	let collected = 0;
	let truncated = false;
	let handle: Awaited<ReturnType<typeof open>> | undefined;

	try {
		handle = await open(filePath, "r");

		while (collected < maxBytes) {
			const want = Math.min(READ_CHUNK_BYTES, maxBytes - collected);
			const buf = Buffer.allocUnsafe(want);
			const { bytesRead } = await handle.read(buf, 0, want, null);
			if (bytesRead === 0) break;

			const chunk = buf.subarray(0, bytesRead);

			// Binary sniff on the first chunk only — by content, never extension.
			if (chunks.length === 0) {
				const sniff = chunk.subarray(0, BINARY_SNIFF_BYTES);
				if (sniff.includes(0)) {
					return {
						ok: false,
						reason: "binary",
						detail: "NUL byte in first chunk",
					};
				}
			}

			chunks.push(chunk);
			collected += bytesRead;
		}

		// One probe byte tells us whether the budget actually cut something off.
		if (collected >= maxBytes) {
			const probe = Buffer.allocUnsafe(1);
			const { bytesRead } = await handle.read(probe, 0, 1, null);
			truncated = bytesRead > 0;
		}
	} catch (err) {
		return { ok: false, reason: "io-error", detail: messageOf(err) };
	} finally {
		await handle?.close().catch(() => {});
	}

	let buffer: Buffer<ArrayBufferLike> = Buffer.concat(chunks, collected);
	if (truncated) buffer = trimPartialUtf8(buffer);

	const bytesRead = buffer.length;
	let content = buffer.toString("utf-8");
	if (content.startsWith(BOM)) content = content.slice(BOM.length);

	const { content: clampedContent, clamped } = clampLongLines(
		content,
		maxLineLength,
	);

	return {
		ok: true,
		content: clampedContent,
		truncated,
		bytesRead,
		totalBytes,
		longLinesClamped: clamped,
	};
}

/** Human-readable one-liner for a failed read — for CLI notes and findings. */
export function describeSafeReadFailure(failure: SafeReadFailure): string {
	switch (failure.reason) {
		case "not-found":
			return "file not found";
		case "not-a-file":
			return failure.detail ?? "not a regular file";
		case "binary":
			return "binary file";
		case "too-large":
			return failure.detail ? `too large (${failure.detail})` : "too large";
		case "io-error":
			return failure.detail ? `read error: ${failure.detail}` : "read error";
	}
}
