import {
	chmodSync,
	mkdtempSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const tempDirs: string[] = [];

function tempDir(prefix: string): string {
	const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
	tempDirs.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of tempDirs.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("ensure-bin-executable", () => {
	it("restores the package CLI bin executable bit after compilation", async () => {
		const directory = tempDir("javi-forge-bin-mode-");
		const binPath = path.join(directory, "index.js");
		writeFileSync(binPath, "#!/usr/bin/env node\n");
		chmodSync(binPath, 0o644);

		const module = await import(
			path.join(repoRoot, "scripts/ensure-bin-executable.mjs")
		);

		module.ensureExecutableFile(binPath);

		expect(statSync(binPath).mode & 0o777).toBe(0o755);
	});
});
