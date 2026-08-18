# Tasks: Linux Support Hardening

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 660-890 total (A 230-300 · B 250-330 · C 180-260) |
| 400-line budget risk | High (as one PR) / Low per slice |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Slice A) → PR 2 (Slice B) → PR 3 (Slice C) |
| Delivery strategy | auto-chain (three chained PRs pinned pre-tasks) |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| A | ACL capability probe + remediation + init decouple | PR 1 | base `main`; ships its own unit tests + docs |
| B | Real-Linux integration suite + two-leg CI | PR 2 | base `main` after A merges; asserts A's remediation text |
| C | node-on-PATH heuristic + invalid-flag semantics | PR 3 | base `main` after B; independent of B, stacked last |

Mode: strict TDD. Every GREEN task requires its RED task failing first. Gates per PR: `pnpm validate` + `pnpm test:coverage` (85/80).

## Phase 1: Slice A — capability probe, remediation, init decouple (PR 1)

- [x] 1.1 GUARD: grep `assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs` for `getfacl`/`spawn`; confirm zero hits (design assumption #3). If hits exist, STOP and report — Decision 1 is invalidated.
- [x] 1.2 RED `src/lib/secure-fs-posix.test.ts`: `probeAclCapability(spawn)` returns `available` / `absent` (ENOENT) / `unknown` (timeout, non-zero, unparseable) via an injected `SpawnFn`; assert `ACL_DETAIL.getfaclAbsent === "getfacl absent"` is exported.
- [x] 1.3 GREEN `src/lib/secure-fs-posix.ts`: export `ACL_DETAIL` tokens and add read-only `probeAclCapability()` (`getfacl --version`). Do NOT touch `proveClean`/`proveNoExtendedAcl`/refusal codes.
- [x] 1.4 RED `src/lib/secure-refusal-remediation.test.ts`: table test — `remediationForRefusal("unsupported-posix-acl", ACL_DETAIL.getfaclAbsent)` names `apt install acl`, `apk add acl`, `dnf install acl`; a real named-user ACL detail returns `undefined` (no package hint); unknown refusal → `undefined`.
- [x] 1.5 GREEN create `src/lib/secure-refusal-remediation.ts` — pure table, no I/O, no Ink import.
- [x] 1.6 RED `src/lib/claude-hook-manager.run.test.ts`: doctor report carries `installCapability: { acl, remediation? }`; row present when `available`; when `absent` and both components are `managed-current`, `execution.status` stays `runnable`, `blockers`/`unknownSources` stay empty and exit code stays 0; when a guard-currency blocker coexists, the acl remediation joins `report.remediation`; probe `unknown` stays inside the section.
- [x] 1.7 GREEN `src/lib/claude-hook-manager.ts`: add `installCapability` to `ClaudeHookDoctorReport`, wire `probeAclCapability`. Never write to `execution` or `healthy`.
- [x] 1.8 RED `src/commands/claude-hooks.test.ts`: `renderMutation` prints the remediation on an adapter-absent refusal (not the bare reason code); `repair` renders identically; `renderDoctor` prints the capability row in both satisfied and absent states.
- [x] 1.9 GREEN `src/commands/claude-hooks.ts`: render capability section + remediation-on-refusal.
- [x] 1.10 RED `src/commands/init/steps/security.test.ts`: with a faked refusing `installClaudePreToolUse`, assert all `setHookFeature` calls still run and a single terminal `report(...)` has status `"error"` naming both the refusal+remediation AND the merged preset.
- [x] 1.11 GREEN `src/commands/init/steps/security.ts`: replace the early `return` (`:93`) with a captured `guardError`; loops always run; one terminal report.
- [x] 1.12 Document the `acl` dependency and the Node-on-PATH requirement in `README.md` and the `hooks` CLI help text.
- [x] 1.13 Run `pnpm validate` + `pnpm test:coverage`; open PR 1 (target ≤300 lines). (Gates run: typecheck/typecheck:test/lint green; unit suite 2353 passed; coverage lines 91.7% / branches 82.48%. `src/e2e/aggressive.e2e.test.ts` fails PRE-EXISTING at HEAD — it spawns the stale `dist/index.js`, unreachable from this diff. PR NOT opened: the orchestrator reviews the diff first.)

## Phase 2: Slice B — real-Linux integration suite + CI (PR 2)

- [x] 2.1 Create `src/__integration__/secure-fs-posix.integration.test.ts` with `describe.skipIf(process.platform !== "linux")` as the ONLY gate. Zero in-test skip branches, zero `if (!ok) return;`.
- [x] 2.2 Fixture base: `mkdtemp` under `process.env.RUNNER_TEMP ?? os.homedir()`, `chmod 0700`; assert owner-is-effective-user and mode `0700` up front — precondition FAILS the suite, never skips. Never `/tmp`.
- [x] 2.3 Test: clean install through the real `getfacl` gate, then a second run is a zero-write no-op (byte- and mtime-stable).
- [x] 2.4 Test: real `setfacl -m u:nobody:r` on a controlling directory → refusal `unsupported-posix-acl`, no target mutated, and NO package remediation in the message.
- [x] 2.5 Test: getfacl-absent in-process — set `process.env.PATH` to an empty dir in `try/finally` → real ENOENT → refusal carries Slice-A's `acl`-package remediation text.
- [x] 2.6 Read `JAVI_FORGE_ACL_LEG` to select EXPECTATIONS only (`absent` vs default). Both legs must execute assertions; the var never gates whether a test runs.
- [x] 2.7 Create `.github/workflows/claude-hook-linux.yml` mirroring `claude-hook-windows.yml`: same triggers, `permissions: contents: read`, SHA-pinned actions, checkout → pnpm → node 22 → `pnpm install --frozen-lockfile`, `strategy.matrix.leg: [with-acl, without-acl]` on `ubuntu-latest`. (Action pinning copied VERBATIM from the windows workflow, which pins by major tag — `actions/checkout@v6`, `pnpm/action-setup@v5`, `actions/setup-node@v6` — not by SHA. Mirroring beats a unilateral divergence; SHA-pinning both workflows is a separate change.)
- [x] 2.8 `with-acl` leg: assert `command -v getfacl` (fail if the image drops it), defensively `apt-get install -y acl`, run the suite.
- [x] 2.9 `without-acl` leg: `sudo mv /usr/bin/getfacl /usr/bin/getfacl.disabled`, then `! command -v getfacl` (fail the job if it still resolves), run the same suite with `JAVI_FORGE_ACL_LEG=absent`. No PATH-shadow stub.
- [x] 2.10 DELETE the dead `/tmp`-rooted test at `src/lib/claude-hook-manager.run.test.ts:304-328`; confirm coverage still meets 85/80. (Post-deletion: lines 91.86% / branches 82.61% — ABOVE the Slice-A baseline of 91.7/82.48, because the new real-adapter suite covers more `secure-fs-posix.ts` than the dead test ever did.)
- [x] 2.11 Run the suite locally (this box is Linux) plus `pnpm validate`; open PR 2 (target ≤330 lines). (Suite run REAL on this Linux box: 5/5 pass in the present leg AND in a simulated absent leg; falsification probe confirms the assertions are live. Gates: typecheck/typecheck:test/lint green; 2358 unit+integration tests pass. `src/e2e/aggressive.e2e.test.ts` fails PRE-EXISTING at HEAD (stale `dist/index.js`); `commit-msg-hook.test.ts` is a 30s-timeout flake under full-suite load and passes alone in 19.9s. Diff is 410 changed lines vs the 250-330 forecast — PR NOT opened; the orchestrator reviews the diff and the budget overrun first.)

## Phase 3: Slice C — node-on-PATH heuristic + invalid-flag semantics (PR 3)

- [x] 3.1 RED `src/lib/claude-hook-settings.test.ts`: table-driven `scanExecutionFlags` over 10 shapes — `true` → `{set:true, reason:"explicit"}`; `false` and key-absent → `{set:false}`; `"true"`, `"false"`, `1`, `0`, `null`, `{}`, `[]` → `{set:true, reason:"invalid", shape}` for BOTH `disableAllHooks` and `allowManagedHooksOnly`. Non-object input remains "not a flag". (RED: 21 failed / 48 passed.)
- [x] 3.2 GREEN `src/lib/claude-hook-settings.ts`: introduce `FlagVerdict` and replace the `=== true` comparison (`:108-116`). (GREEN: 69/69.)
- [x] 3.3 RED `claude-hook-manager.execution.test.ts` (see note): an invalid value yields a blocker labelled `policy:allowManagedHooksOnly@managed (invalid value: string → treated as true)`, `status: "blocked"`, exit 1. `allowManagedHooksOnly` stays inert outside managed sources. (RED: 23 failed / 33 passed.)
- [x] 3.4 GREEN wire the `FlagVerdict` into `probeExecution` blocker construction. (GREEN: 56/56.)
- [x] 3.5 RED `claude-hook-manager.execution.test.ts` (see note) for `probeNodeOnPath` via an injected seam on `ExecutionProbeEnv`: spawn ENOENT → blocker `runtime:node-not-on-PATH (heuristic: this process' PATH)`; major `<22` → blocker `runtime:node-on-PATH v18 (<22, heuristic)`; timeout/non-zero/unparseable → `unknownSources`; present `>=22` → contributes nothing and does NOT clear a pre-existing unknown source. Assert the new `EXECUTION_RESIDUAL` line is always present and `report.node` still reads `process.versions.node`. (RED: 10 failed / 58 passed.)
- [x] 3.6 GREEN `src/lib/claude-hook-manager.ts`: add `probeNodeOnPath`, the residual constant, and the matrix wiring. (GREEN: 68/68.) Plus the spec-mandated always-present `report.nodeOnPath` row (spec `:11,121-141`) probed ONCE per doctor run and rendered as a heuristic — RED 5 failed → GREEN.
- [x] 3.7 RED then GREEN: `warnings: string[]` on `ClaudeHookMutationResult` — install/repair still succeed (`ok: true`) with a non-blocking warning when no PATH `node` resolves; `claude-hooks.ts` renders warnings distinctly from `errors`. (RED: 6 failed → GREEN 59/59.)
- [x] 3.8 Run `pnpm validate` + `pnpm test:coverage`; open PR 3 (target ≤260 lines). (Gates: typecheck/typecheck:test/lint green (7 pre-existing warnings); 2473 passed. `src/e2e/aggressive.e2e.test.ts` fails PRE-EXISTING — PROVEN by stashing the whole slice and running that file at HEAD: 4 failed / 26 passed with zero Slice-C code present. Diff is 844 changed lines (272 production + 572 test) vs the 180-260 forecast — OVER BUDGET, flagged. PR NOT opened; nothing committed or pushed.)

Note on 3.3/3.5 file placement: the tasks named `claude-hook-manager.run.test.ts`, but every
`probeExecution`/`probeExecutionSource` test already lives in `claude-hook-manager.execution.test.ts`
(`run.test.ts` is the `_run` state→action matrix). The new tests were placed with their subject.

## Phase 4: Guard tasks (verify UNTOUCHED across all three PRs)

- [ ] 4.1 Assert the diff touches zero bytes of `assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs` and `manifest.json` (no SHA rotation, no settings-identity change).
- [ ] 4.2 Assert `proveClean` / `proveOwnershipAndMode` / `proveNoExtendedAcl` / the transaction gate + rollback are unchanged; the `SecureRefusal` code union is unchanged.
- [ ] 4.3 Assert doctor's `healthy` definition and the win32 adapter are unchanged; `claude-hook-windows.yml` untouched.
