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

#Requires -Version 7.2
[CmdletBinding()]
param()

# Defense-in-depth: #Requires is parsed by some hosts AFTER the script body.
# 7.2 is the minimum because FileSystemInfo.ResolveLinkTarget($true) is .NET 6+,
# which shipped with pwsh 7.2. Earlier pwsh 7.x runs on .NET 5 and the method
# is absent — the symlink check would silently fall back to no-op.
if ($PSVersionTable.PSEdition -ne 'Core' -or $PSVersionTable.PSVersion -lt [Version]'7.2') {
    Write-Host 'ERROR: ci-local install.ps1 requires PowerShell 7.2+ (pwsh).' -ForegroundColor Red
    Write-Host "Detected: $($PSVersionTable.PSEdition) $($PSVersionTable.PSVersion)" -ForegroundColor Yellow
    Write-Host 'Install: https://github.com/PowerShell/PowerShell/releases' -ForegroundColor Cyan
    exit 1
}

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir  = Split-Path -Parent $PSCommandPath
$ProjectDir = Split-Path -Parent $ScriptDir

# ─── Symlink-safe path resolver ────────────────────────────────────
# Defined inline (NOT in lib/common.psm1) because we need it BEFORE the
# module is loaded — Import-Module on a hostile symlink would already
# execute the attacker's code. Audit round 4 PoC verified.
# Fails closed: any exception aborts the script.
#
# DEFENSE — alias / function shadowing (round 5):
# PowerShell command resolution is Alias > Function > Cmdlet. A
# pre-existing GLOBAL alias of the same name would beat our local
# function. Remove any prior binding before defining, and verify the
# resolved Get-Command points to OUR script file.
Remove-Item Alias:Resolve-RealPath    -Force -ErrorAction SilentlyContinue
Remove-Item Function:Resolve-RealPath -Force -ErrorAction SilentlyContinue
function Resolve-RealPath([string]$P) {
    if ([string]::IsNullOrEmpty($P)) {
        throw "Resolve-RealPath: empty path"
    }
    $item = Get-Item -LiteralPath $P -Force -ErrorAction Stop
    $target = $item.ResolveLinkTarget($true)
    if ($target) {
        # ResolveLinkTarget($true) is platform-inconsistent for dangling
        # links: Linux throws on the call above, but Windows returns a
        # FileSystemInfo whose .Exists is false. Treat both the same.
        if (-not $target.Exists) {
            throw "Resolve-RealPath: dangling symlink target $($target.FullName)"
        }
        return $target.FullName
    }
    return $item.FullName
}
$_rr = Get-Command Resolve-RealPath -ErrorAction SilentlyContinue
if (-not $_rr -or $_rr.CommandType -ne 'Function' -or $_rr.ScriptBlock.File -ne $PSCommandPath) {
    Write-Host 'ERROR: Resolve-RealPath is shadowed by an external command' -ForegroundColor Red
    if ($_rr) {
        Write-Host "  Resolved to: $($_rr.CommandType) at $($_rr.ScriptBlock.File)" -ForegroundColor Yellow
    }
    exit 1
}
Remove-Variable _rr

# Find the shared library (mirrors install.sh's source order).
$libPath = Join-Path $ScriptDir '..' 'lib' 'common.psm1'
if (-not (Test-Path -LiteralPath $libPath -PathType Leaf)) {
    Write-Host "ERROR: lib/common.psm1 not found at $libPath" -ForegroundColor Red
    Write-Host "Copy lib/ alongside ci-local/ (see README)." -ForegroundColor Yellow
    exit 1
}

# SECURITY: validate the module BEFORE importing. A hostile symlink runs
# attacker code at user privilege as soon as Import-Module evaluates it.
# Round 4 (2026-05-17) PoC verified the same hijack on install.sh side.
try {
    $libReal     = Resolve-RealPath $libPath
    $projectReal = Resolve-RealPath $ProjectDir
} catch {
    Write-Host "ERROR: could not resolve lib/common.psm1 or project root: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
$sep = [System.IO.Path]::DirectorySeparatorChar
if (-not ($libReal.Equals($projectReal, [StringComparison]::OrdinalIgnoreCase) -or
          $libReal.StartsWith($projectReal + $sep, [StringComparison]::OrdinalIgnoreCase))) {
    Write-Host 'ERROR: lib/common.psm1 resolves outside the project root' -ForegroundColor Red
    Write-Host "  LIB resolved:     $libReal" -ForegroundColor Yellow
    Write-Host "  PROJECT resolved: $projectReal" -ForegroundColor Yellow
    Write-Host 'Refusing to import. Investigate symlinks under lib/.' -ForegroundColor Yellow
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

    # Reject UNC / remote paths outright — a javi-forge symlinked to
    # \\attacker\share passes the writable-cache check because none of the
    # prefixes match. Two forms to handle:
    #   \\server\share\path         → UNC (reject)
    #   \\?\UNC\server\share\path   → extended-length UNC (reject)
    #   \\?\C:\very\long\path       → extended-length LOCAL (allow)
    if ($jfReal -like '\\\\?\\UNC\\*' -or
        ($jfReal -like '\\\\*' -and -not ($jfReal -like '\\\\?\\*'))) {
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
    # Resolve-RealPath is defined at top level (BEFORE Import-Module) so we
    # can reuse it here for the hooks-dir check. It fails closed — any
    # exception aborts instead of falling back to GetFullPath which does
    # not follow symlinks (the original fallback opened a hole flagged by
    # audit round 4).
    try {
        $hooksAbs   = Resolve-RealPath $hooksDir
        $projectAbs = Resolve-RealPath $ProjectDir
    } catch {
        Write-Host "ERROR: could not resolve hooks dir or project root: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
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
        #
        # Use the current user's SID rather than $env:USERNAME — usernames
        # with spaces ("John Doe") or domain prefixes ("CONTOSO\jdoe")
        # break the SDDL principal syntax; SIDs are unambiguous. Falls
        # back to USERNAME only if the SID lookup fails.
        $principal = $null
        try {
            $principal = ([System.Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
        } catch {
            $principal = $env:USERNAME
        }
        if (-not $principal -or $principal -notmatch '^[\w\-\\:]+$') {
            Write-Host 'WARNING: could not derive a safe principal for icacls; skipping ACL hardening.' -ForegroundColor Yellow
        } else {
            try {
                & icacls $hooksDir /inheritance:r /grant:r "${principal}:(OI)(CI)F" *> $null
                if ($LASTEXITCODE -ne 0) {
                    Write-Host "WARNING: icacls on $hooksDir returned $LASTEXITCODE" -ForegroundColor Yellow
                }
            } catch {
                Write-Host "WARNING: icacls failed: $($_.Exception.Message)" -ForegroundColor Yellow
            }
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
