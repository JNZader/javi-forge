import { lstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	createPosixSecureFs,
	type PosixAclAdapter,
} from "./secure-fs-posix.js";
import { runTransaction, type SecureResult } from "./secure-fs-transaction.js";

const opened = vi.hoisted(() => [] as import("node:fs/promises").FileHandle[]);
const tmpStats = lstatSync(os.tmpdir());
const euid = typeof process.geteuid === "function" ? process.geteuid() : -1;
const hasUnsafeTmpAncestor =
	(tmpStats.mode & 0o022) !== 0 ||
	(tmpStats.uid !== euid && tmpStats.uid !== 0);
const itWithUnsafeTmpAncestor = hasUnsafeTmpAncestor ? it : it.skip;

interface OwnershipAttempt {
	dirPath: string;
	result: SecureResult<void>;
}

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		open: async (...args: Parameters<typeof actual.open>) => {
			const handle = await actual.open(...args);
			opened.push(handle);
			return handle;
		},
	};
});

describe("runTransaction — real rejected handle lifetime", () => {
	itWithUnsafeTmpAncestor(
		"closes real directory FileHandles after an ownership refusal",
		async () => {
			const tmpDir = os.tmpdir();
			const target = path.join(tmpDir, "javi-forge-transaction-handle-target");
			const acl: PosixAclAdapter = {
				proveClean: async () => ({ ok: true }),
				proveNoEndangeringAcl: async () => ({ ok: true }),
			};
			const productionFs = createPosixSecureFs(acl);
			const openedBefore = opened.length;
			const ownershipAttempts: OwnershipAttempt[] = [];
			const secureFs = {
				...productionFs,
				async proveOwnershipAndMode(dirPath: string) {
					const result = await productionFs.proveOwnershipAndMode(dirPath);
					ownershipAttempts.push({ dirPath, result });
					return result;
				},
			};
			const writeExclusive = vi.spyOn(secureFs, "writeExclusive");
			const createDirExclusive = vi.spyOn(secureFs, "createDirExclusive");

			try {
				const outcome = await runTransaction({
					secureFs,
					clock: () => new Date("2026-09-10T00:00:00.000Z"),
					nonce: () => "deadbeef",
					projectDir: target,
					asset: {
						path: path.join(target, ".claude", "hooks", "asset.mjs"),
						desired: Buffer.from("must-not-write"),
						capturePrior: false,
						forceBackup: false,
						wasAbsent: true,
					},
					settings: {
						path: path.join(target, ".claude", "settings.json"),
						desired: Buffer.from("must-not-write"),
						capturePrior: false,
						forceBackup: false,
						wasAbsent: true,
					},
				});

				expect(outcome.ok).toBe(false);
				const refusal = ownershipAttempts.find(({ result }) => !result.ok);
				if (!refusal) throw new Error("expected an ownership refusal");
				expect(refusal.result.refusal).toBe("unsafe-parent-chain");
				expect(outcome.errors).toEqual([
					`ownership ${refusal.dirPath}: ${refusal.result.detail}`,
				]);
				expect(writeExclusive).not.toHaveBeenCalled();
				expect(createDirExclusive).not.toHaveBeenCalled();
				const transactionHandles = opened.slice(openedBefore);
				expect(transactionHandles.length).toBeGreaterThan(0);
				await Promise.all(
					transactionHandles.map((handle) =>
						expect(handle.stat()).rejects.toMatchObject({ code: "EBADF" }),
					),
				);
			} finally {
				await Promise.all(
					opened
						.splice(openedBefore)
						.map((handle) => handle.close().catch(() => {})),
				);
			}
		},
	);
});
