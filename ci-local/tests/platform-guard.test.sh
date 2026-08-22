#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CI_LOCAL_DIR="$ROOT_DIR/ci-local"
PWSH_BIN="$(command -v pwsh)"
GUIDANCE='unsupported-platform: javi-forge supports Linux and Windows only.'

failures=0

assert_status() {
    if [[ "$1" != "$2" ]]; then
        printf "FAIL: %s (expected status %s, got %s)\n" "$3" "$2" "$1" >&2
        failures=$((failures + 1))
    fi
}

assert_contains() {
    if [[ "$1" != *"$2"* ]]; then
        printf "FAIL: %s (missing %s)\n" "$3" "$2" >&2
        failures=$((failures + 1))
    fi
}

run_bash_source_guard() {
    local entrypoint="$1" output status
    set +e
    output="$(timeout 5 bash -c 'source "$1"; ci_local_startup_body() { printf "unexpected-startup=%s\n" "$*"; }; ci_local_main Darwin ignored' bash "$CI_LOCAL_DIR/$entrypoint" 2>&1)"
    status=$?
    set -e
    assert_status "$status" 1 "$entrypoint source guard"
    assert_contains "$output" "$GUIDANCE" "$entrypoint source guidance"
    [[ "$output" != *"unexpected-startup="* ]] || { printf "FAIL: %s source reached startup\n" "$entrypoint" >&2; failures=$((failures + 1)); }
}

run_bash_direct_guard() {
    local entrypoint="$1" probe_dir probe output result_code
    probe_dir="$(mktemp -d)"
    probe="$probe_dir/$entrypoint"
    python3 - "$CI_LOCAL_DIR/$entrypoint" "$probe" <<'PYTHON'
from pathlib import Path
import sys
source = Path(sys.argv[1]).read_text()
for original, replacement in (
    ('ci_local_main "$(/usr/bin/uname -s)" "$@"', 'ci_local_main Darwin "$@"'),
    ('ci_local_main "$(/usr/bin/uname -s)"', 'ci_local_main Darwin'),
):
    if original in source:
        Path(sys.argv[2]).write_text(source.replace(original, replacement, 1))
        break
else:
    raise SystemExit('CI-Local direct tail not found')
PYTHON


    set +e
    output="$(timeout 5 bash "$probe" 2>&1)"
    status=$?
    set -e
    rm -rf "$probe_dir"

    assert_status "$status" 1 "$entrypoint direct guard"
    assert_contains "$output" "$GUIDANCE" "$entrypoint direct guidance"
}

run_bash_windows_host_alias_probe() {
    local entrypoint="$1" raw_platform output status

    for raw_platform in MINGW64_NT-10.0-19045 MSYS_NT-10.0 CYGWIN_NT-10.0; do
        set +e
        output="$(timeout 5 bash -c 'source "$1"; ci_local_startup_body() { printf "startup-reached\n"; }; ci_local_main "$2"; printf "normalized-platform="; ci_local_normalize_platform "$2"' bash "$CI_LOCAL_DIR/$entrypoint" "$raw_platform" 2>&1)"
        status=$?
        set -e

        assert_status "$status" 0 "$entrypoint $raw_platform Windows host alias"
        assert_contains "$output" 'startup-reached' "$entrypoint $raw_platform reaches startup"
        assert_contains "$output" 'normalized-platform=Windows' "$entrypoint $raw_platform normalizes before startup"
    done
}

run_bash_forwarding_probe() {
    local entrypoint="$1" output status
    set +e
    output="$(timeout 5 bash -c 'source "$1"; ci_local_startup_body() { printf "live-output argc=%s args=%s|%s\n" "$#" "$1" "$2"; return 23; }; ci_local_main Linux "first arg" "second arg"' bash "$CI_LOCAL_DIR/$entrypoint" 2>&1)"
    status=$?
    set -e
    assert_status "$status" 23 "$entrypoint bash exit forwarding"
    assert_contains "$output" "live-output argc=2 args=first arg|second arg" "$entrypoint bash argument/output forwarding"
}

run_bash_sourced_identity_probe() {
    local entrypoint="$1" caller_dir output status expected_script_dir
    caller_dir="$(mktemp -d)"
    expected_script_dir="$CI_LOCAL_DIR"

    set +e
    output="$(timeout 5 bash -c 'source "$1"; builtin cd "$2"; ci_local_startup_body() { printf "entrypoint-dir=%s\n" "$CI_LOCAL_ENTRYPOINT_DIR"; }; ci_local_main Linux' bash "ci-local/$entrypoint" "$caller_dir" 2>&1)"
    status=$?
    set -e

    assert_status "$status" 0 "$entrypoint relative source identity"
    assert_contains "$output" "entrypoint-dir=$expected_script_dir" "$entrypoint relative source identity"
    rm -rf "$caller_dir"
}

run_powershell_source_guard() {
    local entrypoint="$1" output status
    set +e
    output="$(timeout 5 "$PWSH_BIN" -NoProfile -NonInteractive -Command ". '$CI_LOCAL_DIR/$entrypoint'; function global:Invoke-CiLocalStartupBody { param([string]\$Platform) Write-Output \"unexpected-startup=\$Platform\" }; \$result = & \${function:Invoke-CiLocalMain} -Platform Darwin; Write-Output \"status=\$result\"; if (\$result -ne 1) { exit 1 }" 2>&1)"
    status=$?
    set -e
    assert_status "$status" 0 "$entrypoint dot-source guard harness"
    assert_contains "$output" "$GUIDANCE" "$entrypoint dot-source guidance"
    assert_contains "$output" "status=1" "$entrypoint dot-source exit forwarding"
    [[ "$output" != *"unexpected-startup="* ]] || { printf "FAIL: %s dot-source reached startup\n" "$entrypoint" >&2; failures=$((failures + 1)); }
}

run_powershell_return_probe() {
    local entrypoint="$1" output result_code
    set +e
    output="$(timeout 5 "$PWSH_BIN" -NoProfile -NonInteractive -Command ". '$CI_LOCAL_DIR/$entrypoint'; function global:Invoke-CiLocalStartupBody { param([string]\$Platform, [ref]\$ExitCode) Write-Output \"live-return=\$Platform\"; return 23 }; \$exitCode = 99; & \${function:Invoke-CiLocalMain} -Platform Windows -ExitCode ([ref]\$exitCode); Write-Output \"return-only-exit-code=\$exitCode\"; if (\$exitCode -ne 0) { exit 1 }" 2>&1)"
    result_code=$?
    set -e
    assert_status "$result_code" 0 "$entrypoint return-only status semantics"
    assert_contains "$output" 'live-return=Windows' "$entrypoint return-only live output"
    assert_contains "$output" 'return-only-exit-code=0' "$entrypoint return-only does not use LASTEXITCODE"
}

run_powershell_supported_probe() {
    local entrypoint="$1" output result_code
    set +e
    output="$(timeout 5 "$PWSH_BIN" -NoProfile -NonInteractive -Command ". '$CI_LOCAL_DIR/$entrypoint'; function global:Invoke-CiLocalStartupBody { param([string]\$Platform, [ref]\$ExitCode) & \$PSHOME/pwsh -NoProfile -NonInteractive -Command 'exit 23'; \$ExitCode.Value = \$LASTEXITCODE; Write-Output \"live-output=\$Platform\" }; \$exitCode = 0; & \${function:Invoke-CiLocalMain} -Platform Windows -ExitCode ([ref]\$exitCode); Write-Output \"exit-code=\$exitCode\"; if (\$exitCode -ne 23) { exit 1 }" 2>&1)"
    result_code=$?
    set -e
    assert_status "$result_code" 0 "$entrypoint Windows output/exit probe"
    assert_contains "$output" 'live-output=Windows' "$entrypoint Windows live output"
    assert_contains "$output" 'exit-code=23' "$entrypoint explicit/native exit propagation"
}

run_powershell_production_native_failure_probe() {
    local entrypoint="$1" shim_dir ref_output ref_status direct_output direct_status ref_command

    shim_dir="$(mktemp -d)"
    case "$entrypoint" in
        ci-local.ps1)
            printf '%s\n' '#!/usr/bin/env sh' 'exit 23' > "$shim_dir/docker"
            chmod +x "$shim_dir/docker"
            ref_command=". '$CI_LOCAL_DIR/$entrypoint'; \$Mode = 'shell'; \$exitCode = 0; & \${function:Invoke-CiLocalMain} -Platform Windows -ExitCode ([ref]\$exitCode); Write-Output \"production-exit-code=\$exitCode\"; if (\$exitCode -ne 23) { exit 1 }"
            ;;
        install.ps1)
            printf '%s\n' '#!/usr/bin/env sh' 'exit 23' > "$shim_dir/javi-forge"
            chmod +x "$shim_dir/javi-forge"
            ref_command=". '$CI_LOCAL_DIR/$entrypoint'; \$exitCode = 0; & \${function:Invoke-CiLocalMain} -Platform Windows -ExitCode ([ref]\$exitCode); Write-Output \"production-exit-code=\$exitCode\"; if (\$exitCode -ne 23) { exit 1 }"
            ;;
        uninstall.ps1)
            printf '%s\n' '#!/usr/bin/env sh' 'if [ "$1" = config ] && [ "$2" = --get ]; then printf hooks; exit 0; fi' 'exit 23' > "$shim_dir/git"
            chmod +x "$shim_dir/git"
            ref_command=". '$CI_LOCAL_DIR/$entrypoint'; \$exitCode = 0; & \${function:Invoke-CiLocalMain} -Platform Windows -ExitCode ([ref]\$exitCode); Write-Output \"production-exit-code=\$exitCode\"; if (\$exitCode -ne 23) { exit 1 }"
            ;;
    esac

    set +e
    ref_output="$(PATH="$shim_dir:$PATH" timeout 5 "$PWSH_BIN" -NoProfile -NonInteractive -Command "$ref_command" 2>&1)"
    ref_status=$?
    if [[ "$entrypoint" == ci-local.ps1 ]]; then
        direct_output="$(PATH="$shim_dir:$PATH" timeout 5 "$PWSH_BIN" -NoProfile -NonInteractive -File "$CI_LOCAL_DIR/$entrypoint" shell 2>&1)"
    else
        direct_output="$(PATH="$shim_dir:$PATH" timeout 5 "$PWSH_BIN" -NoProfile -NonInteractive -File "$CI_LOCAL_DIR/$entrypoint" 2>&1)"
    fi
    direct_status=$?
    set -e
    rm -rf "$shim_dir"

    assert_status "$ref_status" 0 "$entrypoint production native failure ref status"
    assert_contains "$ref_output" 'production-exit-code=23' "$entrypoint production native failure ref value"
    assert_status "$direct_status" 23 "$entrypoint production native failure direct status"
}

run_powershell_install_version_exception_probe() {
    local output result_code command

    command=". '$CI_LOCAL_DIR/install.ps1'; function global:javi-forge { throw 'version-probe-failure' }; \$exitCode = 0; & \${function:Invoke-CiLocalMain} -Platform Windows -ExitCode ([ref]\$exitCode); Write-Output \"exception-exit-code=\$exitCode\"; if (\$exitCode -ne 1) { exit 1 }"

    set +e
    output="$(timeout 5 "$PWSH_BIN" -NoProfile -NonInteractive -Command "$command" 2>&1)"
    result_code=$?
    set -e

    assert_status "$result_code" 0 'install.ps1 launch exception status'
    assert_contains "$output" 'exception-exit-code=1' 'install.ps1 launch exception exit propagation'
}

run_powershell_fail_fast_probe() {
    local mode="$1" probe output result_code command

    probe="$(mktemp "$CI_LOCAL_DIR/.platform-guard-failfast.XXXXXX.ps1")"
    python3 - "$CI_LOCAL_DIR/ci-local.ps1" "$probe" <<'PYTHON'
from pathlib import Path
import sys

source = Path(sys.argv[1]).read_text()
confirm_start = source.index("function Confirm-DockerImage {")
confirm_end = source.index("\n# Convert a host path", confirm_start)
confirm_mock = """function Confirm-DockerImage {
    param([Parameter(Mandatory)][hashtable]$Cfg)
}

"""
source = source[:confirm_start] + confirm_mock + source[confirm_end:]
invoke_start = source.index("function Invoke-InCi {")
invoke_end = source.index("\n#", invoke_start)
invoke_mock = """function Invoke-InCi {
    param(
        [Parameter(Mandatory)][hashtable]$Cfg,
        [Parameter(Mandatory)][string]$Cmd,
        [string]$RunUser = 'runner'
    )

    $global:CiLocalFailFastInvokeCount++
    Write-Output "invoke-count=$global:CiLocalFailFastInvokeCount"
    if ($global:CiLocalFailFastInvokeCount -eq 1) {
        $ExitCode.Value = 23
    }
}
"""
Path(sys.argv[2]).write_text(source[:invoke_start] + invoke_mock + source[invoke_end:])
PYTHON

    command=". '$probe'; \$Mode = '$mode'; \$global:CiLocalFailFastInvokeCount = 0; \$exitCode = 0; & \${function:Invoke-CiLocalMain} -Platform Windows -ExitCode ([ref]\$exitCode); Write-Output \\\"fail-fast-exit-code=\$exitCode\\\"; if (\$exitCode -ne 23 -or \$global:CiLocalFailFastInvokeCount -ne 1) { exit 1 }"

    set +e
    output="$(timeout 5 "$PWSH_BIN" -NoProfile -NonInteractive -Command "$command" 2>&1)"
    result_code=$?
    set -e
    rm -f "$probe"

    assert_status "$result_code" 0 "ci-local.ps1 $mode fail-fast ref status"
    assert_contains "$output" 'invoke-count=1' "ci-local.ps1 $mode stops after first Invoke-InCi failure"
    assert_contains "$output" 'fail-fast-exit-code=23' "ci-local.ps1 $mode fail-fast exit propagation"
    [[ "$output" != *'invoke-count=2'* ]] || { printf 'FAIL: ci-local.ps1 %s invoked a phase after failure\\n' "$mode" >&2; failures=$((failures + 1)); }
}

run_powershell_direct_guard() {
    local entrypoint="$1" source probe_dir probe output status
    local original_platform="\$platform = if (\$IsWindows) { 'Windows' } elseif (\$IsLinux) { 'Linux' } else { 'unsupported' }"
    local refusal_platform="\$platform = 'unsupported'"
    source="$(<"$CI_LOCAL_DIR/$entrypoint")"
    probe_dir="$(mktemp -d)"
    probe="$probe_dir/$entrypoint"
    printf "%s" "${source/$original_platform/$refusal_platform}" > "$probe"
    set +e
    output="$(timeout 5 "$PWSH_BIN" -NoProfile -NonInteractive -File "$probe" 2>&1)"
    status=$?
    set -e
    rm -rf "$probe_dir"
    assert_status "$status" 1 "$entrypoint direct guard"
    assert_contains "$output" "$GUIDANCE" "$entrypoint direct guidance"
}

run_stale_claim_audit() {
    local entrypoint contents normalized

    for entrypoint in ci-local.sh install.sh uninstall.sh ci-local.ps1 install.ps1 uninstall.ps1; do
        contents="$(<"$CI_LOCAL_DIR/$entrypoint")"
        normalized="${contents,,}"
        if [[ "$normalized" == *darwin* || "$normalized" == *macos* || "$normalized" == *homebrew* || "$normalized" == *'brew install'* ]]; then
            printf 'FAIL: %s retains a positive Darwin/macOS/Homebrew claim\n' "$entrypoint" >&2
            failures=$((failures + 1))
        fi
    done
}

run_stale_claim_audit

for entrypoint in ci-local.sh install.sh uninstall.sh; do
    run_bash_source_guard "$entrypoint"
    run_bash_direct_guard "$entrypoint"
    run_bash_forwarding_probe "$entrypoint"
    run_bash_windows_host_alias_probe "$entrypoint"
    run_bash_sourced_identity_probe "$entrypoint"
done

for entrypoint in ci-local.ps1 install.ps1 uninstall.ps1; do
    run_powershell_source_guard "$entrypoint"
    run_powershell_return_probe "$entrypoint"
    run_powershell_supported_probe "$entrypoint"
    run_powershell_production_native_failure_probe "$entrypoint"
    run_powershell_direct_guard "$entrypoint"
done

run_powershell_install_version_exception_probe
run_powershell_fail_fast_probe quick
run_powershell_fail_fast_probe full

if (( failures > 0 )); then
    printf "%s CI-Local platform guard assertion(s) failed.\n" "$failures" >&2
    exit 1
fi

printf "CI-Local platform guards passed.\n"
