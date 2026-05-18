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

    # Warn if the resolved path is in a writable / cache / temp location.
    # On Windows the equivalent risky locations are %TEMP%, %LOCALAPPDATA%\npm-cache,
    # %APPDATA%\npm, plus the POSIX ones for WSL/macOS users.
    $tempPaths = @(
        '/tmp/', '/var/tmp/', '/dev/shm/'
        (Join-Path $HOME '.cache')
        (Join-Path $HOME '.npm/_npx')
        (Join-Path $HOME '.pnpm-store')
    )
    if ($env:TEMP)         { $tempPaths += $env:TEMP }
    if ($env:LOCALAPPDATA) { $tempPaths += (Join-Path $env:LOCALAPPDATA 'npm-cache') }
    if ($env:APPDATA)      { $tempPaths += (Join-Path $env:APPDATA 'npm') }

    foreach ($p in $tempPaths) {
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
    try {
        $hooksRel = [System.IO.Path]::GetRelativePath($ProjectDir, $hooksDir)
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

    # Make hooks executable. chmod is a no-op on NTFS (Windows ignores POSIX
    # bits) so just call it best-effort. Git for Windows ships with chmod
    # via MSYS2, which is the env the hooks themselves run under.
    if (Test-CommandExists -Name 'chmod') {
        Get-ChildItem -LiteralPath $hooksDir -File -ErrorAction SilentlyContinue |
            ForEach-Object { & chmod 0755 $_.FullName }
        Get-ChildItem -LiteralPath $ScriptDir -Filter '*.sh' -File -ErrorAction SilentlyContinue |
            ForEach-Object { & chmod 0755 $_.FullName }
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
