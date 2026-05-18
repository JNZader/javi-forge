# =============================================================================
# CI-LOCAL: Installation Script (PowerShell)
# =============================================================================
# Mirror of ci-local/install.sh for Windows / PowerShell users.
#
# Usage:
#   .\install.ps1
#
# Behaviour MUST match install.sh. Diff against the bash version on every
# change. Test on real Windows + WSL + macOS pwsh before tagging a release.
# =============================================================================

#Requires -Version 7.0
[CmdletBinding()]
param()

# Defense-in-depth: #Requires is parsed by some hosts AFTER the script body.
# Surface a clear error before any logic runs if we're on Windows PowerShell 5.1
# (which has different strict-mode semantics and lacks GetRelativePath).
if ($PSVersionTable.PSEdition -ne 'Core') {
    Write-Host 'ERROR: ci-local install.ps1 requires PowerShell 7+ (pwsh).' -ForegroundColor Red
    Write-Host "Detected: $($PSVersionTable.PSEdition) $($PSVersionTable.PSVersion)" -ForegroundColor Yellow
    Write-Host 'Install: https://github.com/PowerShell/PowerShell/releases' -ForegroundColor Cyan
    exit 1
}

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir  = Split-Path -Parent $PSCommandPath
$ProjectDir = Split-Path -Parent $ScriptDir

# Find the shared library (mirrors install.sh's source order).
$libPath = Join-Path $ScriptDir '..' 'lib' 'common.psm1'
if (-not (Test-Path -LiteralPath $libPath -PathType Leaf)) {
    Write-Host "ERROR: lib/common.psm1 not found at $libPath" -ForegroundColor Red
    Write-Host "Copy lib/ alongside ci-local/ (see README)." -ForegroundColor Yellow
    exit 1
}
Import-Module $libPath -Force

Write-Host '=== CI-LOCAL Installation ===' -ForegroundColor Cyan

Push-Location -LiteralPath $ProjectDir
try {

    # ─── Verify javi-forge CLI is available ────────────────────────────
    # The git hooks (pre-commit, pre-push) invoke `javi-forge ci ...`.
    # Catch a missing CLI BEFORE configuring hooks so the user gets a
    # clear error instead of a silent "command not found" on first commit.
    if (-not (Test-CommandExists -Name 'javi-forge')) {
        Write-Host 'ERROR: javi-forge CLI not found in PATH' -ForegroundColor Red
        Write-Host ''
        Write-Host 'The git hooks (pre-commit, pre-push) require the javi-forge CLI.'
        Write-Host 'Install it globally:'
        Write-Host '  npm install -g javi-forge' -ForegroundColor Cyan
        Write-Host ''
        Write-Host 'Or, if you are developing javi-forge itself, link the workspace:'
        Write-Host '  pnpm link --global' -ForegroundColor Cyan
        Write-Host ''
        exit 1
    }

    # Resolve the binary path. Get-Command returns an ApplicationInfo whose
    # .Source is the absolute path. Resolve any symlink chain via .Target
    # (PowerShell 6+ exposes symlink Target on FileInfo).
    $jfCmd  = Get-Command -Name 'javi-forge'
    $jfPath = $jfCmd.Source
    $jfReal = $jfPath
    try {
        $jfItem = Get-Item -LiteralPath $jfPath -Force -ErrorAction Stop
        if ($jfItem.LinkType -eq 'SymbolicLink' -and $jfItem.Target) {
            $target = $jfItem.Target
            if ($target -is [array]) { $target = $target[0] }
            if (-not [System.IO.Path]::IsPathRooted($target)) {
                $target = Join-Path (Split-Path -Parent $jfPath) $target
            }
            $jfReal = [System.IO.Path]::GetFullPath($target)
        }
    } catch {
        # If Get-Item fails (e.g. on platforms without symlink support), keep $jfPath.
    }

    $jfVersionOk     = $true
    $jfVersionOutput = ''
    try {
        $jfVersionOutput = (& javi-forge --version 2>&1) -join "`n"
        if ($LASTEXITCODE -ne 0) { $jfVersionOk = $false }
    } catch {
        $jfVersionOk     = $false
        $jfVersionOutput = $_.Exception.Message
    }

    if ($jfVersionOk) {
        if ($jfPath -eq $jfReal) {
            Write-Host "javi-forge: $jfVersionOutput ($jfPath)" -ForegroundColor Green
        } else {
            Write-Host "javi-forge: $jfVersionOutput ($jfPath -> $jfReal)" -ForegroundColor Green
        }
    } else {
        Write-Host "ERROR: javi-forge found at $jfPath but '--version' failed" -ForegroundColor Red
        Write-Host "Output: $jfVersionOutput" -ForegroundColor Yellow
        Write-Host 'Reinstall: npm install -g javi-forge' -ForegroundColor Cyan
        exit 1
    }

    # Reject UNC paths outright — a javi-forge symlinked to \\attacker\share
    # passes the writable-cache check below because none of the prefixes
    # match. UNC targets are unusual for a CLI install and worth surfacing.
    if ($jfReal -like '\\\\*') {
        Write-Host "ERROR: javi-forge resolves to a UNC / network path ($jfReal)." -ForegroundColor Red
        Write-Host 'Refusing to wire hooks against a remote binary.' -ForegroundColor Yellow
        exit 1
    }

    # Warn if the resolved path is in a writable / cache / temp location.
    # Build the candidate list defensively: an empty env var would produce
    # something like Join-Path '' 'npm-cache' = 'npm-cache', which then
    # matches every path containing that substring (Opus-alt PoC).
    function Test-IsAbsolutePath([string]$P) {
        if ([string]::IsNullOrWhiteSpace($P)) { return $false }
        try { return [System.IO.Path]::IsPathRooted($P) } catch { return $false }
    }

    $tempPaths = @('/tmp/', '/var/tmp/', '/dev/shm/')
    foreach ($candidate in @(
        (Join-Path $HOME '.cache'),
        (Join-Path $HOME '.npm/_npx'),
        (Join-Path $HOME '.pnpm-store')
    )) {
        if (Test-IsAbsolutePath $candidate) { $tempPaths += $candidate }
    }
    if (Test-IsAbsolutePath $env:TEMP)         { $tempPaths += $env:TEMP }
    if (Test-IsAbsolutePath $env:LOCALAPPDATA) { $tempPaths += (Join-Path $env:LOCALAPPDATA 'npm-cache') }
    if (Test-IsAbsolutePath $env:APPDATA)      { $tempPaths += (Join-Path $env:APPDATA 'npm') }

    foreach ($p in $tempPaths) {
        if ([string]::IsNullOrWhiteSpace($p)) { continue }
        if ($jfReal.StartsWith($p, [StringComparison]::OrdinalIgnoreCase)) {
            Write-Host "WARNING: javi-forge resolves to a writable/cache directory ($jfReal)." -ForegroundColor Yellow
            Write-Host 'Caches can be overwritten by package installs — prefer a stable global location.' -ForegroundColor Yellow
            break
        }
    }

    # ─── Configure git hooks ──────────────────────────────────────────
    Write-Host '[1/2] Configuring git hooks...' -ForegroundColor Yellow

    # Compute hooksPath RELATIVE to the project root so the same install.ps1
    # works whether the dir is "ci-local" (dev checkout) or ".ci-local"
    # (user's project after copying via install instructions).
    $hooksDir = Join-Path $ScriptDir 'hooks'

    # SECURITY: reject hooksPath that escapes the project root. If
    # ci-local/hooks is a symlink/junction pointing outside the project,
    # GetRelativePath returns "../../../somewhere/evil" and every future
    # commit executes whatever lives there. Audit round 3 caught this.
    #
    # GetFullPath does NOT follow symlinks — it only normalises ".." etc.
    # FileSystemInfo.ResolveLinkTarget($true) (introduced in .NET 6) walks
    # the full chain. Available in pwsh 7.2+; #Requires above pins 7.0
    # but ResolveLinkTarget is still present on 7.0/7.1 builds shipped by
    # MS, so this is safe.
    function Resolve-RealPath([string]$P) {
        if ([string]::IsNullOrEmpty($P)) { return $P }
        try {
            $item = Get-Item -LiteralPath $P -Force -ErrorAction Stop
            $target = $item.ResolveLinkTarget($true)
            if ($target) { return $target.FullName }
            return $item.FullName
        } catch {
            return [System.IO.Path]::GetFullPath($P)
        }
    }
    $hooksAbs   = Resolve-RealPath $hooksDir
    $projectAbs = Resolve-RealPath $ProjectDir
    $sep = [System.IO.Path]::DirectorySeparatorChar
    if (-not ($hooksAbs.Equals($projectAbs, [StringComparison]::OrdinalIgnoreCase) -or
              $hooksAbs.StartsWith($projectAbs + $sep, [StringComparison]::OrdinalIgnoreCase))) {
        Write-Host 'ERROR: hooks directory resolves outside the project root' -ForegroundColor Red
        Write-Host "  HOOKS_DIR resolved to: $hooksAbs" -ForegroundColor Yellow
        Write-Host "  PROJECT_DIR:           $projectAbs" -ForegroundColor Yellow
        Write-Host 'Refusing to set core.hooksPath. Investigate symlinks/junctions under ci-local/.' -ForegroundColor Yellow
        exit 1
    }

    try {
        $hooksRel = [System.IO.Path]::GetRelativePath($projectAbs, $hooksAbs)
    } catch {
        $hooksRel = $hooksDir
    }
    # Normalize separators to forward slashes (git config uses POSIX paths).
    $hooksRel = $hooksRel -replace '\\', '/'

    & git config core.hooksPath $hooksRel
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'ERROR: failed to set core.hooksPath. Are you inside a git repo?' -ForegroundColor Red
        exit 1
    }
    Write-Host "hooksPath = $hooksRel" -ForegroundColor Green

    # Make hooks executable. Different OS, different model:
    #   - macOS / Linux / WSL: chmod 0755 — POSIX bits, what git expects.
    #   - Windows native NTFS: chmod is a no-op; lock the ACL via icacls so
    #     only the current user can rewrite the hooks between commits.
    if (Test-CommandExists -Name 'chmod') {
        Get-ChildItem -LiteralPath $hooksDir -File -ErrorAction SilentlyContinue |
            ForEach-Object { & chmod 0755 $_.FullName }
        Get-ChildItem -LiteralPath $ScriptDir -Filter '*.sh' -File -ErrorAction SilentlyContinue |
            ForEach-Object { & chmod 0755 $_.FullName }
    }
    if ($IsWindows -and (Test-CommandExists -Name 'icacls')) {
        # Restrict hooks dir to current user (F = full, OI/CI = inherit to
        # files/subfolders). /inheritance:r drops any permissive parent ACL.
        # Best-effort: failures are non-fatal but visible.
        try {
            & icacls $hooksDir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" *> $null
            if ($LASTEXITCODE -ne 0) {
                Write-Host "WARNING: icacls on $hooksDir returned $LASTEXITCODE" -ForegroundColor Yellow
            }
        } catch {
            Write-Host "WARNING: icacls failed: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    Write-Host 'Done' -ForegroundColor Green

    # ─── Dependency check ─────────────────────────────────────────────
    Write-Host '[2/2] Checking dependencies...' -ForegroundColor Yellow

    $dockerOk = $false
    if (Test-CommandExists -Name 'docker') {
        try {
            & docker info *> $null
            if ($LASTEXITCODE -eq 0) { $dockerOk = $true }
        } catch { }
    }
    if ($dockerOk) {
        Write-Host 'Docker: available' -ForegroundColor Green
    } else {
        Write-Host 'Docker: not running (required for pre-push CI)' -ForegroundColor Yellow
    }

    if (Test-CommandExists -Name 'semgrep') {
        Write-Host 'Semgrep: installed (native)' -ForegroundColor Green
    } elseif ($dockerOk) {
        Write-Host 'Semgrep: available via Docker (returntocorp/semgrep)' -ForegroundColor Green
    } else {
        Write-Host 'Semgrep: not available (install semgrep or Docker)' -ForegroundColor Yellow
    }

    Write-Host ''
    Write-Host 'Setup complete!' -ForegroundColor Green
    Write-Host ''
    Write-Host 'Hooks enabled:'
    Write-Host '  - pre-commit: AI check + lint + security'
    Write-Host '  - commit-msg: Block AI attribution (best-effort)'
    Write-Host '  - pre-push:   CI simulation in Docker'
    Write-Host ''
    Write-Host 'NOTE: git hooks are bash scripts. On Windows they run via the'
    Write-Host 'MSYS2 bash bundled with Git for Windows. WSL is also supported.'
    Write-Host ''

} finally {
    Pop-Location
}
