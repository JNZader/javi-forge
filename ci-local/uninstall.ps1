# =============================================================================
# CI-LOCAL: Uninstall Script (PowerShell)
# =============================================================================
# Mirror of ci-local/uninstall.sh for Windows / PowerShell users.
#
# Usage:
#   .\uninstall.ps1                       # only unset core.hooksPath
#   .\uninstall.ps1 -RestoreBackups       # also restore .bak hooks
#   .\uninstall.ps1 -Purge                # also rm -rf ci-local/ + lib/
# =============================================================================

#Requires -Version 7.2
[CmdletBinding()]
param(
    [switch]$RestoreBackups,
    [switch]$Purge
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir  = Split-Path -Parent $PSCommandPath
$ProjectDir = Split-Path -Parent $ScriptDir

Push-Location -LiteralPath $ProjectDir
try {

    Write-Host '=== CI-LOCAL Uninstall ===' -ForegroundColor Cyan

    # 1. Unset core.hooksPath if set
    Write-Host '[1/3] Removing core.hooksPath...' -ForegroundColor Yellow
    $current = (& git config --get core.hooksPath 2>$null) -join ''
    if ($current) {
        & git config --unset core.hooksPath
        Write-Host "Removed hooksPath = $current" -ForegroundColor Green
    } else {
        Write-Host 'No core.hooksPath was set; nothing to remove' -ForegroundColor Yellow
    }

    # 2. Restore .bak hooks if requested
    Write-Host '[2/3] Restoring hook backups...' -ForegroundColor Yellow
    if ($RestoreBackups) {
        $restored = 0
        foreach ($hook in 'pre-commit', 'commit-msg', 'pre-push') {
            $bak = ".git/hooks/$hook.bak"
            if (Test-Path -LiteralPath $bak -PathType Leaf) {
                Move-Item -LiteralPath $bak -Destination ".git/hooks/$hook" -Force
                Write-Host "Restored .git/hooks/$hook" -ForegroundColor Green
                $restored++
            }
        }
        if ($restored -eq 0) {
            Write-Host 'No .bak hooks found to restore' -ForegroundColor Yellow
        }
    } else {
        Write-Host 'Skipped (pass -RestoreBackups to enable)' -ForegroundColor Yellow
    }

    # 3. Purge ci-local/ if requested
    Write-Host '[3/3] Purging ci-local/ directory...' -ForegroundColor Yellow
    if ($Purge) {
        if (Test-Path -LiteralPath '.ci-local' -PathType Container) {
            Remove-Item -LiteralPath '.ci-local' -Recurse -Force
            Write-Host 'Removed .ci-local/' -ForegroundColor Green
        }
        # Refuse to delete our own working directory.
        if (Test-Path -LiteralPath 'ci-local' -PathType Container) {
            $thisScriptDir = (Get-Item -LiteralPath $ScriptDir).FullName
            $ciLocalDir    = (Get-Item -LiteralPath (Join-Path $ProjectDir 'ci-local')).FullName
            if ($thisScriptDir -eq $ciLocalDir) {
                Write-Host 'WARNING: ci-local/ contains THIS uninstall script.' -ForegroundColor Yellow
                Write-Host 'Refusing to delete it. Remove manually after this script exits.' -ForegroundColor Yellow
            }
        }
    } else {
        Write-Host 'Skipped (pass -Purge to delete directories)' -ForegroundColor Yellow
    }

    Write-Host ''
    Write-Host 'Uninstall complete!' -ForegroundColor Green
    Write-Host ''

} finally {
    Pop-Location
}
