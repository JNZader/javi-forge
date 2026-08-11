# Archive Report — hook-consolidation

**Change**: `hook-consolidation` · **Repo**: `/home/javier/programacion/platform/javi-forge`
**Verdict**: **ARCHIVED** · **Cycle status**: CLOSED
**Archive destination**: `openspec/changes/archive/2026-08-11-hook-consolidation/`
**Artifact store**: hybrid (filesystem + Engram) · **Final tree**: `main` @ `6ec0f02e`
**Verification**: PASS (archive-ready) — 0 CRITICAL, 2 WARNING (advisory, deferred to Phase-5 docs pass), 0 SUGGESTION.

## 1. Delivery

All 6 slices merged to `main` @ `6ec0f02e` via PRs **#35–#40** (slices S1a–S5).

| Slice | Scope | PR |
|---|---|---|
| S1a | Dispatcher (`src/commands/hooks.ts`) + `hooks:` config (`ci-config.ts` v2, `validateHooks`) | #35 |
| S1b | Static shims (pre-commit v2, pre-push v3) exec `javi-forge hooks run <name>` + manifest bump + fleet-brick guard | #36 |
| S2 | Init reconciliation + ATOMIC `core.hooksPath` detect-before-mutate guard in `installCIHooks` | #37 |
| S3 | TDD fold — generated TDD writers deleted; TDD section composed at hook-run time | #38 |
| S4 | Security fold + K-005 NUL-safe file handling + doctor advisories (L4–L6); `templates/security-hooks/*` bodies deleted | #39 |
| S5 | Docs + e2e round-trip + passive `ci-local/` deprecation note | #40 |

**Tasks**: all boxes `[x]` in `tasks.md` (S1a 1.1–1.6, S1b 2.1–2.5, S2 3.1–3.5, S3 4.1–4.5, S4 5.1–5.7, S5 6.1–6.3). Task Completion Gate PASSED — zero unchecked implementation tasks, no stale-checkbox reconciliation needed or performed.

## 2. Specs promoted into the source of truth

The change carried two delta specs. Both were merged into `openspec/specs/` before the folder move.

| Domain | Action | Details |
|---|---|---|
| `hook-dispatch` | **Created** `openspec/specs/hook-dispatch/spec.md` | NEW capability — full spec promoted whole: 6 requirements (Static shims exec the dispatcher · Composition driven by hooks config · Fail-closed gate sections · Honest pre-push messaging · Security sections L1–L3 NUL-safe · L4–L6 are doctor advisories). No prior main spec existed, so the delta was copied verbatim under a provenance header. |
| `ci-hook-install` | **Updated** `openspec/specs/ci-hook-install/spec.md` | 2 MODIFIED, 4 ADDED, 0 REMOVED. |

### `ci-hook-install` merge detail (prior `ci-engine-unification` requirements PRESERVED)

**MODIFIED (2)** — matched by requirement name, replaced in place, `(Previously: …)` provenance retained per repo convention:

- *pre-push runs a native substantive gate, fail-closed* — was "MUST run `javi-forge ci --quick --no-docker --no-security --no-ci-ghagga` (native validate + coverage)"; now a static shim that execs `javi-forge hooks run pre-push`, whose CI section runs the IN-PROCESS `runCI({mode:"quick", noDocker:true, noSecurity:true, noGhagga:true})` option set (setup + lint + compile + gates; NO test phase, NO coverage). DOC-004 mislabel corrected. Image-gated fail-closed + no-degrade-branch scenarios preserved.
- *Hooks are verified by execution* — was "including the frozen flag invocation `--quick --no-docker --no-security --no-ci-ghagga`"; now asserts the shim → dispatcher → composed in-process behavior, NOT a CLI flag string (no subprocess spawned).

**ADDED (4)** — appended after *New hook bodies auto-upgrade silently via retained history*:

- *core.hooksPath detection before install* — 5-step atomic detect-before-mutate guard (classify slots → scoped `--global`/`--system` shadow read → local-value ≠ exact `ci-local/hooks` → foreign-slot refusal → only-then unset+install); every refuse path = zero mutation (D6).
- *Shim release preserves silent auto-upgrade* — manifest version bump + outgoing sha256 retained in `historical[]` + appended to `RELEASED_SNAPSHOT` → prior managed bodies classify `managed-outdated`, never `foreign`.
- *init delegates hook provisioning to the hardened installer* — `init` calls `installCIHooks`; MUST NOT set `core.hooksPath` nor copy `ci-local/` bodies.
- *Legacy generated TDD hooks migrate via the foreign path* — with the unhardened TDD writers deleted, an old generated TDD body classifies `foreign`; refusal + backup-then-`--force` IS its migration.

**PRESERVED unchanged** (from `ci-engine-unification`): Versioned marker and content hash · Classify before write · Legacy unmarked fleet content is upgradable · Marker-present-but-drifted is edited · No-clobber policy · Forced overwrite backs up first · Broken install surfaces as named error · Hook templates shipped as package assets · commit-msg AI-attribution guard · commit-msg conventional-commit subjects · commit-msg body is a packaged tested asset · New hook bodies auto-upgrade silently via retained history.

## 3. Deferred work — Phase-5 docs/spec pass follow-ups

Both verification WARNINGs are advisory-only and did NOT block archive. Carried forward:

- **W1** — `src/cli/dispatch/ci.tsx:111` stale `"Hooks call javi-forge ci (with npx fallback)"` string; deferred to the docs pass per the S5 constraint (docs-only, no behavior change).
- **W2** — `includeIf` / conditional-scope `hooksPath` residual edge: the scoped `--global`/`--system` reads in the D6 guard do not cover a value injected only via an `[includeIf]` conditional include. Documented in the design (D6) and in the promoted `ci-hook-install` "core.hooksPath detection before install" requirement as a known residual edge; a future hardening pass may extend detection.

## 4. Traceability

**Engram observations** (project `javi-forge`):

| ID | Artifact |
|---|---|
| 13679 | `sdd/hook-consolidation/explore` |
| 13680 | `sdd/hook-consolidation/proposal` |
| 13683 | `sdd/hook-consolidation/spec` (delta specs mirror) |
| 13684 | `sdd/hook-consolidation/design` (D1–D9) |
| 13688 | `sdd/hook-consolidation/apply-progress` (S1a–S5) |
| 13849 | `sdd/hook-consolidation/verify-report` |
| — | `sdd/hook-consolidation/archive-report` (this report) |

**Gap, stated honestly**: there is no dedicated `sdd/hook-consolidation/tasks` Engram observation. In hybrid mode the filesystem `tasks.md` (all boxes `[x]`) is the canonical task-completion record; Engram carries the amendment-level observations above plus this archive report.

**Filesystem (archived audit trail — never modify)**:
`openspec/changes/archive/2026-08-11-hook-consolidation/` — `exploration.md`, `proposal.md`,
`specs/hook-dispatch/spec.md`, `specs/ci-hook-install/spec.md`, `design.md`, `tasks.md`,
`verify-report.md`, `archive-report.md`.

## 5. SDD cycle complete

`hook-consolidation` has been planned, implemented (6 slices, PRs #35–#40), verified (PASS, 0 CRITICAL), its delta specs promoted into the source of truth, and archived. The change is CLOSED. The two advisory WARNINGs are the only carried-forward items, tracked for the Phase-5 docs/spec pass.
