import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ciLocalDir = path.join(repoRoot, "ci-local");

const MACOS_GUIDANCE =
	"macOS is deprecated and unsupported for new CI-Local install/startup. Pin a supported release or migrate. Existing installed guards are not removed; Darwin code removal is planned separately for 2.0.";

const bashEntrypoints = ["install.sh", "ci-local.sh"] as const;
const powerShellEntrypoints = ["install.ps1", "ci-local.ps1"] as const;
const powerShellExecutable = process.env.CI_LOCAL_PWSH?.trim() || "pwsh";
const powerShellAvailable = (() => {
	const probe = spawnSync(
		powerShellExecutable,
		["-NoProfile", "-NonInteractive", "-Command", "exit 0"],
		{ cwd: repoRoot, encoding: "utf8" },
	);
	return probe.status === 0 && probe.error === undefined;
})();

function runBash(script: string): ReturnType<typeof spawnSync> {
	return spawnSync("bash", ["-c", script], {
		cwd: repoRoot,
		encoding: "utf8",
	});
}

function quoteForBash(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function quoteForPowerShell(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function runPowerShell(args: string[]): ReturnType<typeof spawnSync> {
	return spawnSync(powerShellExecutable, args, {
		cwd: repoRoot,
		encoding: "utf8",
	});
}

describe("CI-Local macOS platform support", () => {
	it("does not pin PowerShell integration tests to one machine path", () => {
		const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
		const pinnedPath = ["/home", "linuxbrew", ".linuxbrew", "bin", "pwsh"].join("/");
		expect(source).not.toContain(pinnedPath);
	});

	it.each(bashEntrypoints)(
		"%s sources safely and refuses Darwin before every downstream primitive",
		(entrypoint) => {
			const script = path.join(ciLocalDir, entrypoint);
			const result = runBash(`
				calls=0
				for primitive in realpath git docker mkdir cp chmod readlink javi-forge; do
					eval "$primitive() { calls=$((calls + 1)); return 0; }"
				done
				sentinel=unchanged
				source ${quoteForBash(script)}
				ci_local_main Darwin
				status=$?
				printf 'status=%s calls=%s sentinel=%s\\n' "$status" "$calls" "$sentinel"
				exit "$status"
			`);

			expect(result.status).toBe(1);
			expect(result.stdout).toContain(MACOS_GUIDANCE);
			expect(result.stdout).toContain("status=1 calls=0 sentinel=unchanged");
		},
	);

	it.each(["quick", "shell", "detect", "full"] as const)(
		"ci-local.sh forwards the original %s mode without injecting the platform",
		(mode) => {
			const script = path.join(ciLocalDir, "ci-local.sh");
			const result = runBash(`
				source ${quoteForBash(script)}
				ci_local_startup_body() { printf 'supported-startup mode=%s argc=%s\\n' "$1" "$#"; }
				ci_local_main Linux ${mode}
			`);

			expect(result.status).toBe(0);
			expect(result.stdout).toContain(
				`supported-startup mode=${mode} argc=1`,
			);
		},
	);

	it.each(["install.sh"] as const)(
		"%s reaches its unchanged supported-host startup body",
		(entrypoint) => {
			const script = path.join(ciLocalDir, entrypoint);
			const result = runBash(`
				source ${quoteForBash(script)}
				ci_local_startup_body() { printf 'supported-startup=%s\\n' "$1"; }
				ci_local_main Linux
			`);

			expect(result.status).toBe(0);
			expect(result.stdout).toContain("supported-startup=Linux");
		},
	);

	it.runIf(powerShellAvailable)
		.each(powerShellEntrypoints)(
			"%s dot-sources safely and refuses Darwin before every downstream primitive",
			(entrypoint) => {
				const script = path.join(ciLocalDir, entrypoint);
				const command = `
					. ${quoteForPowerShell(script)}
					$script:calls = 0
					function global:Import-Module { $script:calls++ }
					function global:Get-Item { $script:calls++ }
					function global:Test-Path { $script:calls++; $false }
					function global:Push-Location { $script:calls++ }
					$sentinel = 'unchanged'
					$result = Invoke-CiLocalMain -Platform Darwin
					Write-Output "status=$result calls=$script:calls sentinel=$sentinel"
					if ($result -ne 1) { exit 1 }
				`;
				const result = runPowerShell(["-NoProfile", "-Command", command]);

				expect(result.status).toBe(0);
				expect(result.stdout).toContain(MACOS_GUIDANCE);
				expect(result.stdout).toContain(
					"status=1 calls=0 sentinel=unchanged",
				);
			},
		);

	it.runIf(powerShellAvailable)
		.each(powerShellEntrypoints)(
			"%s reaches its unchanged supported-host startup body",
			(entrypoint) => {
				const script = path.join(ciLocalDir, entrypoint);
				const command = `
					. ${quoteForPowerShell(script)}
					function global:Invoke-CiLocalStartupBody { param([string]$Platform); Write-Output "supported-startup=$Platform" }
					Invoke-CiLocalMain -Platform Linux
				`;
				const result = runPowerShell(["-NoProfile", "-Command", command]);

				expect(result.status).toBe(0);
				expect(result.stdout).toContain("supported-startup=Linux");
			},
		);

	it.runIf(powerShellAvailable)(
		"ci-local.ps1 keeps startup-body success output live in production",
		() => {
			const source = readFileSync(path.join(ciLocalDir, "ci-local.ps1"), "utf8");
			const bodyStart = source.indexOf("function Invoke-CiLocalStartupBody {");
			const tailStart = source.lastIndexOf(
				"if ($MyInvocation.InvocationName -ne '.') {",
			);
			expect(bodyStart).toBeGreaterThanOrEqual(0);
			expect(tailStart).toBeGreaterThan(bodyStart);

			const tempDir = mkdtempSync(path.join(os.tmpdir(), "ci-local-output-"));
			const probePath = path.join(tempDir, "ci-local.ps1");
			const probe = `${source.slice(0, bodyStart)}function Invoke-CiLocalStartupBody {\n\tparam([string]$Platform)\n\tWrite-Output "live-body-output=$Platform"\n}\n\n${source.slice(tailStart)}`;
			writeFileSync(probePath, probe);

			try {
				const result = runPowerShell([
					"-NoProfile",
					"-File",
					probePath,
					"detect",
				]);

				expect(result.status).toBe(0);
				expect(result.stdout).toContain("live-body-output=Windows");
			} finally {
				rmSync(tempDir, { force: true, recursive: true });
			}
		},
	);

	it.runIf(powerShellAvailable)
		.each(powerShellEntrypoints)(
			"%s invokes its local main function instead of a pre-existing alias",
			(entrypoint) => {
				const source = readFileSync(path.join(ciLocalDir, entrypoint), "utf8");
				const tempDir = mkdtempSync(path.join(os.tmpdir(), "ci-local-alias-"));
				const probePath = path.join(tempDir, entrypoint);
				const probe = source.replace(
					"$platform = if ($IsMacOS) { 'Darwin' } else { 'Windows' }",
					"$platform = 'Darwin'",
				);
				writeFileSync(probePath, probe);

				try {
					const command = `
						function global:Test-AliasIntercept {
							param([string]$Platform, [ref]$ExitCode)
							Write-Output "alias-intercepted=$Platform"
							if ($ExitCode) { $ExitCode.Value = 0 }
							return 0
						}
						Set-Alias -Scope Global -Name Invoke-CiLocalMain -Value Test-AliasIntercept -Force
						& ${quoteForPowerShell(probePath)}
						exit $LASTEXITCODE
					`;
					const result = runPowerShell(["-NoProfile", "-Command", command]);

					expect(result.status).toBe(1);
					expect(result.stdout).toContain(MACOS_GUIDANCE);
					expect(result.stdout).not.toContain("alias-intercepted=Darwin");
				} finally {
					rmSync(tempDir, { force: true, recursive: true });
				}
			},
		);

	it("keeps production detection trusted and keeps execution tails out of sourced scripts", () => {
		for (const entrypoint of bashEntrypoints) {
			const contents = readFileSync(path.join(ciLocalDir, entrypoint), "utf8");
			const expectedTail =
				entrypoint === "ci-local.sh"
					? 'ci_local_main "$(/usr/bin/uname -s)" "$@"'
					: 'ci_local_main "$(/usr/bin/uname -s)"';
			expect(contents).toContain(expectedTail);
			expect(contents).toContain('if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then');
			expect(contents).not.toMatch(/CI_LOCAL_(?:PLATFORM|OS)/);
		}

		for (const entrypoint of powerShellEntrypoints) {
			const contents = readFileSync(path.join(ciLocalDir, entrypoint), "utf8");
			expect(contents).toContain("$platform = if ($IsMacOS) { 'Darwin' } else { 'Windows' }");
			expect(contents).toContain("if ($MyInvocation.InvocationName -ne '.') {");
			if (entrypoint === "ci-local.ps1") {
				expect(contents).toContain(
					"& ${function:Invoke-CiLocalMain} -Platform $platform -ExitCode ([ref]$exitCode)",
				);
				expect(contents).not.toContain(
					"$exitCode = Invoke-CiLocalMain -Platform $platform",
				);
			}
			expect(contents).not.toMatch(/CI_LOCAL_(?:PLATFORM|OS)/);
		}
	});

	it.each([
		["root README", repoRoot],
		["CI-Local README", ciLocalDir],
	] as const)(
		"documents macOS as refused without affirmative support claims or current removal in %s",
		(_label, directory) => {
			const contents = readFileSync(path.join(directory, "README.md"), "utf8");
			expect(contents).toContain("deprecated and unsupported");
			expect(contents).toContain("Pin a supported release or migrate");
			expect(contents).toContain("Existing installed guards are not removed");
			expect(contents).toContain("planned separately for 2.0");
			expect(contents).not.toMatch(/macOS support has been removed/i);
			expect(contents).not.toMatch(/Linux\/Mac(?:\/WSL)?/i);

			for (const line of contents.split(/\r?\n/).filter((line) => /macOS/i.test(line))) {
				expect(line).not.toMatch(/`(?:install|ci-local)\.sh`|\bmacOS\b.*\b(?:is|remains|still)\s+supported\b/i);
			}

			if (directory === ciLocalDir) {
				const macosMatrixRow = contents
					.split(/\r?\n/)
					.find((line) => /^\|\s*macOS\s*\|/i.test(line));
				expect(macosMatrixRow).toContain("Unsupported");
				expect(macosMatrixRow).toContain("Refused before startup");
				expect(macosMatrixRow).not.toMatch(/`(?:install|ci-local)\.sh`/i);
			}
		},
	);
});
