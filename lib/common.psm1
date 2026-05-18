# =============================================================================
# lib/common.psm1 - Shared functions for javi-forge (PowerShell)
# =============================================================================
# Mirror of lib/common.sh for Windows / PowerShell users.
#
# Import from scripts:   Import-Module "$PSScriptRoot/../lib/common.psm1" -Force
# Import from ci-local:  Import-Module "$PSScriptRoot/../lib/common.psm1" -Force
#
# Keep this file in sync with lib/common.sh. The function signatures use
# PowerShell verb-noun conventions but the BEHAVIOUR must match the bash
# version. Diff against lib/common.sh on every change.
# =============================================================================

Set-StrictMode -Version Latest

# =============================================================================
# Logging helpers
# =============================================================================
function Write-Ok    { param([string]$Message) Write-Host "  [OK]   $Message" -ForegroundColor Green }
function Write-Warn  { param([string]$Message) Write-Host "  [WARN] $Message" -ForegroundColor Yellow }
function Write-Fail  { param([string]$Message) Write-Host "  [FAIL] $Message" -ForegroundColor Red }
function Write-Info  { param([string]$Message) Write-Host "  [INFO] $Message" -ForegroundColor Cyan }
function Write-Step  { param([string]$Message) Write-Host $Message -ForegroundColor Yellow }

# =============================================================================
# Backup-FileIfExists - Create a .bak copy of a file before overwriting
# =============================================================================
function Backup-FileIfExists {
    param([Parameter(Mandatory)][string]$Path)
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        Copy-Item -LiteralPath $Path -Destination "$Path.bak" -Force
        Write-Host "  Backed up existing $Path" -ForegroundColor Yellow
    }
}

# =============================================================================
# Get-Stack - Auto-detect project technology stack
# =============================================================================
# Returns a hashtable with: StackType, BuildTool, JavaVersion
# Detects: java-gradle, java-maven, node, python, go, rust
# Mirrors detect_stack() from lib/common.sh.
# =============================================================================
function Get-Stack {
    param([string]$ProjectDir = '.')

    $result = @{
        StackType   = 'unknown'
        BuildTool   = ''
        JavaVersion = '21'
    }

    # Allow user override via $env:CI_LOCAL_STACK. Mirrors the bash side.
    $override = $env:CI_LOCAL_STACK
    if ($override) {
        $valid = @('node', 'python', 'go', 'rust', 'java-gradle', 'java-maven')
        if ($valid -contains $override) {
            $result.StackType = $override
            switch ($override) {
                'node' {
                    if      (Test-Path -LiteralPath (Join-Path $ProjectDir 'pnpm-lock.yaml') -PathType Leaf) { $result.BuildTool = 'pnpm' }
                    elseif  (Test-Path -LiteralPath (Join-Path $ProjectDir 'yarn.lock')      -PathType Leaf) { $result.BuildTool = 'yarn' }
                    else    { $result.BuildTool = 'npm' }
                }
                'python' {
                    if     (Test-Path -LiteralPath (Join-Path $ProjectDir 'uv.lock')     -PathType Leaf) { $result.BuildTool = 'uv' }
                    elseif (Test-Path -LiteralPath (Join-Path $ProjectDir 'poetry.lock') -PathType Leaf) { $result.BuildTool = 'poetry' }
                    elseif (Test-Path -LiteralPath (Join-Path $ProjectDir 'Pipfile')     -PathType Leaf) { $result.BuildTool = 'pipenv' }
                    else   { $result.BuildTool = 'pip' }
                }
                'go'          { $result.BuildTool = 'go' }
                'rust'        { $result.BuildTool = 'cargo' }
                'java-gradle' { $result.BuildTool = 'gradle' }
                'java-maven'  { $result.BuildTool = 'maven' }
            }
            return $result
        }
        Write-Warning "CI_LOCAL_STACK='$override' is not recognised. Falling back to auto-detection."
    }

    # Java + Gradle
    $gradleKts = Join-Path $ProjectDir 'build.gradle.kts'
    $gradle    = Join-Path $ProjectDir 'build.gradle'
    if ((Test-Path -LiteralPath $gradleKts -PathType Leaf) -or
        (Test-Path -LiteralPath $gradle    -PathType Leaf)) {
        $result.StackType = 'java-gradle'
        $result.BuildTool = 'gradle'
        # Extract Java version from build file (regex parity with sh version)
        $sourceFile = if (Test-Path -LiteralPath $gradleKts -PathType Leaf) { $gradleKts } else { $gradle }
        try {
            $content = Get-Content -LiteralPath $sourceFile -Raw -ErrorAction Stop
            if ($sourceFile -like '*.kts') {
                if ($content -match 'languageVersion\s*=\s*JavaLanguageVersion\.of\(\s*(\d+)') {
                    $result.JavaVersion = $Matches[1]
                }
            } else {
                if ($content -match 'sourceCompatibility\s*=\s*[''"]?\s*(\d+)') {
                    $result.JavaVersion = $Matches[1]
                }
            }
        } catch {
            # Keep default '21'
        }
        return $result
    }

    # Java + Maven
    if (Test-Path -LiteralPath (Join-Path $ProjectDir 'pom.xml') -PathType Leaf) {
        $result.StackType = 'java-maven'
        $result.BuildTool = 'maven'
        return $result
    }

    # Node.js
    if (Test-Path -LiteralPath (Join-Path $ProjectDir 'package.json') -PathType Leaf) {
        $result.StackType = 'node'
        if      (Test-Path -LiteralPath (Join-Path $ProjectDir 'pnpm-lock.yaml') -PathType Leaf) { $result.BuildTool = 'pnpm' }
        elseif  (Test-Path -LiteralPath (Join-Path $ProjectDir 'yarn.lock')      -PathType Leaf) { $result.BuildTool = 'yarn' }
        else    { $result.BuildTool = 'npm' }
        return $result
    }

    # Python — uv > poetry > pipenv > pip
    $pyMarker = @('pyproject.toml', 'setup.py', 'requirements.txt') |
        ForEach-Object { Join-Path $ProjectDir $_ } |
        Where-Object   { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
    if ($pyMarker) {
        $result.StackType = 'python'
        if     (Test-Path -LiteralPath (Join-Path $ProjectDir 'uv.lock')     -PathType Leaf) { $result.BuildTool = 'uv' }
        elseif (Test-Path -LiteralPath (Join-Path $ProjectDir 'poetry.lock') -PathType Leaf) { $result.BuildTool = 'poetry' }
        elseif (Test-Path -LiteralPath (Join-Path $ProjectDir 'Pipfile')     -PathType Leaf) { $result.BuildTool = 'pipenv' }
        else   { $result.BuildTool = 'pip' }
        return $result
    }

    # Go
    if (Test-Path -LiteralPath (Join-Path $ProjectDir 'go.mod') -PathType Leaf) {
        $result.StackType = 'go'
        $result.BuildTool = 'go'
        return $result
    }

    # Rust
    if (Test-Path -LiteralPath (Join-Path $ProjectDir 'Cargo.toml') -PathType Leaf) {
        $result.StackType = 'rust'
        $result.BuildTool = 'cargo'
        return $result
    }

    return $result
}

# =============================================================================
# Test-CommandExists - Returns $true if a command is available in PATH
# =============================================================================
# Replaces "command -v X" from bash.
# =============================================================================
function Test-CommandExists {
    param([Parameter(Mandatory)][string]$Name)
    [bool](Get-Command -Name $Name -ErrorAction SilentlyContinue)
}

Export-ModuleMember -Function `
    Write-Ok, Write-Warn, Write-Fail, Write-Info, Write-Step, `
    Backup-FileIfExists, `
    Get-Stack, `
    Test-CommandExists
