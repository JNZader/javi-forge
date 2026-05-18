# =============================================================================
# CI-LOCAL: Universal CI Simulation (PowerShell)
# =============================================================================
# Mirror of ci-local/ci-local.sh for Windows / PowerShell users.
#
# Usage:
#   .\ci-local.ps1               # full CI
#   .\ci-local.ps1 quick         # lint + compile only
#   .\ci-local.ps1 shell         # interactive shell inside CI container
#   .\ci-local.ps1 detect        # print detected stack and exit
#
# Behaviour MUST match ci-local.sh. Diff against the bash version on every
# change.
# =============================================================================

#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('full', 'quick', 'shell', 'detect')]
    [string]$Mode = 'full'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir  = Split-Path -Parent $PSCommandPath
$ProjectDir = Split-Path -Parent $ScriptDir

# ─── Load shared lib ──────────────────────────────────────────────────
$libCandidates = @(
    (Join-Path $ScriptDir 'lib' 'common.psm1')
    (Join-Path $ScriptDir '..' 'lib' 'common.psm1')
)
$libPath = $libCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $libPath) {
    Write-Host 'ERROR: lib/common.psm1 not found' -ForegroundColor Red
    exit 1
}
Import-Module $libPath -Force

# ─── Stack detection + per-stack CI commands ──────────────────────────
function Get-CiConfig {
    param([string]$ProjectDir)

    $stack = Get-Stack -ProjectDir $ProjectDir

    $cfg = @{
        StackType   = $stack.StackType
        BuildTool   = $stack.BuildTool
        JavaVersion = $stack.JavaVersion
        Dockerfile  = ''
        LintCmd     = ''
        CompileCmd  = ''
        TestCmd     = ''
    }

    switch ($stack.StackType) {
        'java-gradle' {
            $cfg.Dockerfile = 'java.Dockerfile'
            $cfg.LintCmd    = './gradlew spotlessCheck --no-daemon'
            $cfg.CompileCmd = './gradlew clean classes testClasses --no-daemon && chown -R runner:runner build .gradle 2>/dev/null || true'
            $cfg.TestCmd    = './gradlew test --no-daemon'
        }
        'java-maven' {
            $cfg.Dockerfile = 'java.Dockerfile'
            $cfg.LintCmd    = './mvnw spotless:check'
            $cfg.CompileCmd = './mvnw clean compile test-compile && chown -R runner:runner target .mvn 2>/dev/null || true'
            $cfg.TestCmd    = './mvnw test'
        }
        'node' {
            $cfg.Dockerfile = 'node.Dockerfile'
            $pkg = Join-Path $ProjectDir 'package.json'
            $pkgRaw = Get-Content -LiteralPath $pkg -Raw -ErrorAction SilentlyContinue
            if ($pkgRaw -and ($pkgRaw -match '"lint"'))      { $cfg.LintCmd    = "$($stack.BuildTool) run lint" }
            if ($pkgRaw -and ($pkgRaw -match '"build"'))     { $cfg.CompileCmd = "rm -rf dist build && $($stack.BuildTool) run build && chown -R runner:runner dist build 2>/dev/null || true" }
            if ($pkgRaw -and ($pkgRaw -match '"test"')) {
                $cfg.TestCmd = "$($stack.BuildTool) test"
                if ($pkgRaw -match '"test:hooks"') {
                    $cfg.TestCmd = "$($cfg.TestCmd) && $($stack.BuildTool) run test:hooks"
                }
            }
        }
        'python' {
            $cfg.Dockerfile = 'python.Dockerfile'
            $cfg.LintCmd    = 'ruff check . && { pylint **/*.py 2>/dev/null || true; }'
            $cfg.TestCmd    = 'pytest'
        }
        'go' {
            $cfg.Dockerfile = 'go.Dockerfile'
            $cfg.LintCmd    = 'golangci-lint run'
            $cfg.CompileCmd = 'go clean -cache && go build ./... && chown -R runner:runner . 2>/dev/null || true'
            $cfg.TestCmd    = 'go test ./...'
        }
        'rust' {
            $cfg.Dockerfile = 'rust.Dockerfile'
            $cfg.LintCmd    = 'cargo clippy -- -D warnings'
            $cfg.CompileCmd = 'cargo clean && cargo build && chown -R runner:runner target 2>/dev/null || true'
            $cfg.TestCmd    = 'cargo test'
        }
    }

    return $cfg
}

# ─── Docker helpers ───────────────────────────────────────────────────
function Get-ImageName {
    param([string]$StackType)
    "ci-local-$StackType"
}

function New-Dockerfile {
    param([Parameter(Mandatory)][hashtable]$Cfg)

    $dockerDir = Join-Path $ScriptDir 'docker'
    New-Item -ItemType Directory -Force -Path $dockerDir | Out-Null
    $target = Join-Path $dockerDir $Cfg.Dockerfile

    # Heredoc bodies kept byte-identical to ci-local.sh so the image-hash
    # cache aligns across platforms when the same Dockerfile is generated.
    $content = switch ($Cfg.StackType) {
        { $_ -in 'java-gradle','java-maven' } {
@'
ARG JAVA_VERSION=21
FROM eclipse-temurin:${JAVA_VERSION}-jdk-noble
RUN apt-get update && apt-get install -y git curl unzip && rm -rf /var/lib/apt/lists/*
RUN useradd -m -s /bin/bash runner
USER runner
WORKDIR /home/runner/work
ENV GRADLE_USER_HOME=/home/runner/.gradle
ENTRYPOINT ["/bin/bash", "-c"]
'@
        }
        'node' {
@'
FROM node:22-slim
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm
RUN useradd -m -s /bin/bash runner
USER runner
WORKDIR /home/runner/work
ENTRYPOINT ["/bin/bash", "-c"]
'@
        }
        'python' {
@'
FROM python:3.12-slim
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir pytest ruff pylint poetry
RUN useradd -m -s /bin/bash runner
USER runner
WORKDIR /home/runner/work
ENTRYPOINT ["/bin/bash", "-c"]
'@
        }
        'go' {
@'
FROM golang:1.23-bookworm
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN go install github.com/golangci/golangci-lint/cmd/golangci-lint@v1.62.0 && \
    mv /root/go/bin/golangci-lint /usr/local/bin/
RUN useradd -m -s /bin/bash runner
USER runner
WORKDIR /home/runner/work
ENTRYPOINT ["/bin/bash", "-c"]
'@
        }
        'rust' {
@'
FROM rust:1.83-slim
RUN apt-get update && apt-get install -y git pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
RUN rustup component add clippy rustfmt
RUN useradd -m -s /bin/bash runner
USER runner
WORKDIR /home/runner/work
ENTRYPOINT ["/bin/bash", "-c"]
'@
        }
        default {
@'
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*
RUN useradd -m -s /bin/bash runner
USER runner
WORKDIR /home/runner/work
ENTRYPOINT ["/bin/bash", "-c"]
'@
        }
    }

    # Write with LF line endings to match the bash output, so the
    # dockerfile-hash label stays consistent between platforms.
    [System.IO.File]::WriteAllText($target, ($content + "`n"), [System.Text.UTF8Encoding]::new($false))
    Write-Host "Created $($Cfg.Dockerfile)" -ForegroundColor Green
}

function Confirm-DockerImage {
    param([Parameter(Mandatory)][hashtable]$Cfg)

    $imageName  = Get-ImageName -StackType $Cfg.StackType
    $dockerfile = Join-Path $ScriptDir 'docker' $Cfg.Dockerfile

    if (-not (Test-Path -LiteralPath $dockerfile -PathType Leaf)) {
        Write-Host "Creating Dockerfile for $($Cfg.StackType)..." -ForegroundColor Yellow
        New-Dockerfile -Cfg $Cfg
    }

    # SHA256 of the Dockerfile content — matches `sha256sum` from the bash version.
    $hash = (Get-FileHash -LiteralPath $dockerfile -Algorithm SHA256).Hash.ToLowerInvariant()
    $imageHash = ''
    try {
        $imageHash = & docker inspect --format='{{index .Config.Labels "dockerfile-hash"}}' $imageName 2>$null
    } catch { }

    if ($hash -ne $imageHash) {
        Write-Host 'Building CI Docker image...' -ForegroundColor Yellow
        $buildArgs = @('--label', "dockerfile-hash=$hash")
        if ($Cfg.JavaVersion -and $Cfg.StackType -like 'java-*') {
            $buildArgs += @('--build-arg', "JAVA_VERSION=$($Cfg.JavaVersion)")
        }
        & docker build @buildArgs -f $dockerfile -t $imageName (Join-Path $ScriptDir 'docker')
        if ($LASTEXITCODE -ne 0) { throw 'docker build failed' }
    }
}

function Invoke-InCi {
    param(
        [Parameter(Mandatory)][hashtable]$Cfg,
        [Parameter(Mandatory)][string]$Cmd,
        [string]$RunUser = 'runner'
    )

    $imageName = Get-ImageName -StackType $Cfg.StackType

    $timeout = if ($env:CI_LOCAL_TIMEOUT) { $env:CI_LOCAL_TIMEOUT } else { '600' }
    if ($timeout -notmatch '^\d+$') {
        Write-Host "Error: CI_LOCAL_TIMEOUT must be a positive integer, got: $timeout" -ForegroundColor Red
        exit 1
    }

    $dockerFlags = @('--rm')
    # Allocate a TTY only when stdin is a real terminal — same as `[ -t 0 ]`.
    if ([Environment]::UserInteractive -and $Host.UI.RawUI) { $dockerFlags += '-it' }

    & docker run @dockerFlags `
        --stop-timeout 30 `
        --entrypoint '' `
        --user $RunUser `
        -v "$($ProjectDir):/home/runner/work" `
        -e CI=true `
        $imageName timeout $timeout bash -c $Cmd
    if ($LASTEXITCODE -ne 0) { throw "step failed with exit $LASTEXITCODE" }
}

# ─── Main ─────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '=== CI-LOCAL ===' -ForegroundColor Yellow

$cfg = Get-CiConfig -ProjectDir $ProjectDir

if ($cfg.StackType -eq 'unknown') {
    Write-Host 'Could not detect project type!' -ForegroundColor Red
    Write-Host 'Supported: Java/Gradle, Java/Maven, Node, Python, Go, Rust' -ForegroundColor Yellow
    exit 1
}

Write-Host "Detected: $($cfg.StackType) ($($cfg.BuildTool))" -ForegroundColor Green
if ($cfg.StackType -like 'java-*') {
    Write-Host "Java version: $($cfg.JavaVersion)" -ForegroundColor Green
}

$ghaggaAvailable = Test-CommandExists -Name 'ghagga'

switch ($Mode) {
    'detect' {
        Write-Host ''
        Write-Host 'Stack details:' -ForegroundColor Cyan
        Write-Host "  Type: $($cfg.StackType)"
        Write-Host "  Build tool: $($cfg.BuildTool)"
        Write-Host "  Dockerfile: $($cfg.Dockerfile)"
        Write-Host "  Lint: $($cfg.LintCmd)"
        Write-Host "  Compile: $($cfg.CompileCmd)"
        Write-Host "  Test: $($cfg.TestCmd)"
        exit 0
    }

    'quick' {
        Confirm-DockerImage -Cfg $cfg
        Write-Host ''
        Write-Host 'Running quick check...' -ForegroundColor Yellow

        if ($cfg.LintCmd) {
            Write-Host "Lint: $($cfg.LintCmd)" -ForegroundColor Cyan
            Invoke-InCi -Cfg $cfg -Cmd "cd /home/runner/work && $($cfg.LintCmd)"
        }
        if ($cfg.CompileCmd) {
            Write-Host "Compile: $($cfg.CompileCmd)" -ForegroundColor Cyan
            Invoke-InCi -Cfg $cfg -Cmd "cd /home/runner/work && $($cfg.CompileCmd)" -RunUser 'root'
        }
    }

    'shell' {
        Confirm-DockerImage -Cfg $cfg
        Write-Host ''
        Write-Host 'Opening shell in CI environment...' -ForegroundColor Yellow
        $imageName = Get-ImageName -StackType $cfg.StackType
        & docker run --rm -it `
            -v "$($ProjectDir):/home/runner/work" `
            -e CI=true `
            $imageName 'cd /home/runner/work && bash'
    }

    Default {
        # 'full'
        Confirm-DockerImage -Cfg $cfg
        Write-Host ''
        Write-Host 'Running full CI simulation...' -ForegroundColor Yellow

        $total = 0
        if ($cfg.LintCmd)    { $total++ }
        if ($cfg.CompileCmd) { $total++ }
        if ($cfg.TestCmd)    { $total++ }
        if ($ghaggaAvailable) { $total++ }

        $step = 1

        if ($cfg.LintCmd) {
            Write-Host ''
            Write-Host "Step $step/$total`: Lint" -ForegroundColor Yellow
            Write-Host "  $($cfg.LintCmd)" -ForegroundColor Cyan
            Invoke-InCi -Cfg $cfg -Cmd "cd /home/runner/work && $($cfg.LintCmd)"
            $step++
        }

        if ($cfg.CompileCmd) {
            Write-Host ''
            Write-Host "Step $step/$total`: Compile" -ForegroundColor Yellow
            Write-Host "  $($cfg.CompileCmd)" -ForegroundColor Cyan
            Invoke-InCi -Cfg $cfg -Cmd "cd /home/runner/work && $($cfg.CompileCmd)" -RunUser 'root'
            $step++
        }

        if ($cfg.TestCmd) {
            Write-Host ''
            Write-Host "Step $step/$total`: Test" -ForegroundColor Yellow
            Write-Host "  $($cfg.TestCmd)" -ForegroundColor Cyan
            Invoke-InCi -Cfg $cfg -Cmd "cd /home/runner/work && $($cfg.TestCmd)"
            $step++
        }

        if ($ghaggaAvailable) {
            Write-Host ''
            Write-Host "Step $step/$total`: GHAGGA Review" -ForegroundColor Yellow
            Write-Host '  ghagga review --plain --exit-on-issues' -ForegroundColor Cyan
            & ghagga review --plain --exit-on-issues
            if ($LASTEXITCODE -ne 0) {
                Write-Host 'GHAGGA review found issues!' -ForegroundColor Red
                exit 1
            }
        }
    }
}

Write-Host ''
Write-Host 'CI Local completed successfully!' -ForegroundColor Green
Write-Host '  Safe to push - CI should pass.' -ForegroundColor Green
Write-Host ''
