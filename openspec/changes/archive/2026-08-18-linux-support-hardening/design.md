# Design: Linux Support Hardening

## Technical Approach

Fail-closed is retained. Every change is a **read-only probe plus honest reporting**; no proof
logic is weakened. Two new seams: a read-only ACL *capability* probe in `secure-fs-posix.ts`
(distinct from the per-target `proveClean` prover at `:111-139`), and a `node`-on-PATH probe
feeding `probeExecution` (`claude-hook-manager.ts:494-590`). Refusal codes stay frozen; user
copy lives in a new pure mapping module consumed by the renderers.

The central honesty rule: **`execution.status` answers exactly one question — will the
INSTALLED guard fire?** Anything that only affects install/repair capability must never enter
`blockers`/`unknownSources`, or a genuinely running guard would be reported `blocked` (exit 1).

## Architecture Decisions

### Decision 1 — absent `getfacl`: a separate install-capability section, NOT the execution matrix

| Option | Tradeoff | Verdict |
|---|---|---|
| **(a) Own doctor section `installCapability`** | Honest: `getfacl` is an install-time dep of the transactional gate (`secure-fs-transaction.ts:290-295` over the ancestor chain `:378-384`); the installed `.mjs` guard never spawns it | **CHOSEN** |
| (b) Fold into `unknownSources` | A current, firing guard on a slim image would degrade to `inconclusive` (exit 2) for a reason unrelated to execution — false-blocked noise | Runner-up |
| (c) `blockers` | Strictly wrong: flips a running guard to `blocked` | Rejected |

Rationale: the two questions are different. Coupling is preserved where it is REAL — when a
guard-currency blocker already exists (`:562-567`), the acl remediation line is added to
`report.remediation`, because there the user must install/repair and cannot. When both
components are `managed-current`, absent `getfacl` is reported as a warning section only and
the exit code stays driven by `execution.status`. A probe that times out or errors reports
`unknown` **inside that section**, never in `unknownSources`.

### Decision 2 — absent `node` on PATH: BLOCKER, explicitly labelled a heuristic

| Option | Tradeoff | Verdict |
|---|---|---|
| **Blocker with heuristic wording** | Kills the fail-open hole (`HOST_RESIDUAL` `:55-56`): exec-form `command:"node"` that cannot resolve means the guard NEVER fires | **CHOSEN** |
| `unknownSources` | Our PATH ≠ Claude Code's PATH, so it is only evidence — but `inconclusive` under-states a near-certain dead guard | Runner-up |

Asymmetry decides it. **False-blocked** (our PATH lacks `node`, Claude Code's has it) is
implausible: javi-forge itself runs on Node, and nvm/fnm/volta put `node` on the same shell
PATH. **False-runnable** (we resolve `node`, the GUI-launched Claude Code does not) is the real
Linux failure and is UNFIXABLE by probing — so a successful probe grants nothing and a new
constant is appended to `EXECUTION_RESIDUAL` (`:466-469`): *"the hook is exec-form; `node` is
resolved from Claude Code's PATH, which this process cannot observe"*.

Rules: `node --version` spawn ENOENT → blocker `runtime:node-not-on-PATH (heuristic: this
process' PATH)`. Resolves but major `<22` → blocker `runtime:node-on-PATH v18 (<22, heuristic)`.
Timeout/non-zero/unparseable → `unknownSources`. Present and `>=22` → contributes nothing.
This row is DISTINCT from `report.node`, which keeps measuring `process.versions.node` (`:628`).

**Install warning: YES, non-blocking.** `installClaudePreToolUse`/`repair` gain
`warnings: string[]`; when the probe finds no PATH `node`, install still succeeds and prints
the warning. Refusing to install would leave the host with NO guard — strictly worse.

### Decision 3 — without-acl CI leg: displace the binary, assert absence

| Option | Tradeoff | Verdict |
|---|---|---|
| **`sudo mv /usr/bin/getfacl /usr/bin/getfacl.disabled`** | Deterministic, no package resolver, no network; `/bin`→`/usr/bin` symlink so one move covers both; provable with `! command -v getfacl` | **CHOSEN** |
| `sudo apt-get remove -y acl` | Also real, but a dependency resolver can cascade and its behaviour drifts with runner images | Runner-up |
| `container: node:22-slim` | Most faithful (the actual defect environment) but needs git/toolchain bootstrapping and is the slowest | Deferred |

Explicitly rejected: a **PATH-shadow stub**. A stub that exists gets executed, producing
`getfacl exit N` (`secure-fs-posix.ts:127-129`) — a DIFFERENT refusal path than the ENOENT
`"getfacl absent"` (`:123-124`) we must prove. The leg starts with
`if command -v getfacl; then echo "leg is a no-op"; exit 1; fi`.

### Decision 4 — remediation mapping lives in the CLI layer, keyed by exported detail constants

New pure module `src/lib/secure-refusal-remediation.ts`: `remediationForRefusal(refusal, detail)`.
The adapter stays a prover with zero user copy and its `SecureRefusal` codes are untouched. To
avoid stringly-typed coupling, `secure-fs-posix.ts` exports the detail tokens it emits
(`ACL_DETAIL.getfaclAbsent = "getfacl absent"`, …) and the table keys off them. Three consumers:
`claude-hooks.ts` `renderMutation` (`:57-59`), `renderDoctor`, and `init/steps/security.ts`.

### Decision 5 — invalid-flag semantics (`scanExecutionFlags`, `claude-hook-settings.ts:108-116`)

Per Claude Code docs an invalid value is treated as `true`. Per shape, when the key is PRESENT:

| Value | Verdict |
|---|---|
| `true` | set — `explicit` |
| `false` | not set (definitive clear) |
| key absent / `undefined` | not set |
| `"true"`, `"false"`, `1`, `0`, `""`, `null`, `{}`, `[]` | **set — `invalid` → BLOCKING**, shape named |

Note the counterintuitive but correct case: the STRING `"false"` blocks. Return type becomes
`FlagVerdict = {set:false} | {set:true; reason:"explicit"} | {set:true; reason:"invalid"; shape:string}`
so the manager can emit `policy:allowManagedHooksOnly@managed (invalid value: string → treated
as true)`. Non-object input still yields "not a flag" (unreadability is decided upstream).
The managed-only inertness of `allowManagedHooksOnly` (`claude-hook-manager.ts:556`) is unchanged.

### Decision 6 — init reports, then merges anyway

`security.ts` restructure: replace the early `return` at `:93` with a captured
`guardError`; the `setHookFeature` loops (`:99-104`) then ALWAYS run; a single terminal
`report(...)` uses status `"error"` when `guardError` is set (visibility retained — no downgrade
to `done`) with a detail that names BOTH the refusal + remediation AND the preset that was
merged.

## Data Flow

    hooks doctor claude
      ├─ classify asset/settings ──┐
      ├─ probeAclCapability() ─────┼─→ installCapability section (+ remediation IF a
      │   (getfacl --version)      │      currency blocker exists)   [never exit-code]
      └─ probeExecution() ─────────┘
           ├─ settings sources → scanExecutionFlags (invalid ⇒ blocking)
           ├─ guard-currency blockers
           └─ probeNodeOnPath() → blocker (heuristic) | unknown | nothing
                                        └─→ execution.status → exit 0/1/2

## File Changes

| File | Slice | Action | Description |
|---|---|---|---|
| `src/lib/secure-fs-posix.ts` | A | Modify | `probeAclCapability()` + exported `ACL_DETAIL` tokens; prover logic untouched |
| `src/lib/secure-refusal-remediation.ts` | A | Create | Pure `SecureRefusal`+detail → remediation table |
| `src/lib/claude-hook-manager.ts` | A/C | Modify | `installCapability` on the report; `probeNodeOnPath` + residual line; `warnings` on mutation result |
| `src/commands/claude-hooks.ts` | A/C | Modify | Render capability section, remediation on refusal, install warnings |
| `src/commands/init/steps/security.ts` | A | Modify | Decouple refusal from the profile merge |
| `README.md`, CLI help | A | Modify | Document the `acl` dependency + Node-on-PATH requirement |
| `src/__integration__/secure-fs-posix.integration.test.ts` | B | Create | Real getfacl/setfacl suite, private 0700 base |
| `.github/workflows/claude-hook-linux.yml` | B | Create | Two legs (with acl / getfacl displaced) |
| `src/lib/claude-hook-manager.run.test.ts` | B | Modify | Delete the dead `/tmp` test (`:304-328`) — replaced by the integration suite |
| `src/lib/claude-hook-settings.ts` | C | Modify | `FlagVerdict` invalid-value semantics |

## Interfaces / Contracts

```ts
export type AclCapability =
  | { status: "available"; tool: "getfacl" | "/bin/ls" }
  | { status: "absent"; tool: "getfacl" | "/bin/ls" }
  | { status: "unknown"; tool: string; detail: string }
  | { status: "not-applicable"; tool: "windows-secure-object" };

// on ClaudeHookDoctorReport — NOT part of `healthy`, NOT part of `execution`
installCapability: { acl: AclCapability; remediation?: string };
// on ClaudeHookMutationResult
warnings: string[];
```

## CI Workflow — `.github/workflows/claude-hook-linux.yml`

Mirrors `claude-hook-windows.yml` (same triggers, `permissions: contents: read`, pinned
actions, checkout → pnpm → node 22 → `pnpm install --frozen-lockfile`), one job with a
`strategy.matrix.leg: [with-acl, without-acl]` on `ubuntu-latest`:

- `with-acl`: assert `command -v getfacl` (fail if the runner image ever drops it), install
  `acl` defensively, run the integration suite.
- `without-acl`: `sudo mv /usr/bin/getfacl /usr/bin/getfacl.disabled`, assert
  `! command -v getfacl`, then run the same suite with `JAVI_FORGE_ACL_LEG=absent` so the
  suite asserts the refusal text + doctor capability row instead of the happy path.

The leg env var selects EXPECTATIONS, never whether assertions run — both legs assert.

## Testing Strategy

| Slice | Layer | What | Approach |
|---|---|---|---|
| A | Unit | `probeAclCapability` available/absent/timeout | Injected `SpawnFn` |
| A | Unit | remediation table per refusal+detail; renderer output | Pure table tests + captured `log` |
| A | Unit | init merges the profile on guard refusal | Faked `installClaudePreToolUse` → assert `setHookFeature` calls + `error` status |
| B | Integration | Real install/idempotent re-run/repair under a 0700 `mkdtemp` in `RUNNER_TEMP`/`$HOME` — **never `/tmp`**; real `setfacl -m u:nobody:r` → `unsupported-posix-acl` | `describe.skipIf(platform !== "linux")` ONLY; ZERO in-test skip branches — the private-base precondition is asserted, not tolerated |
| B | Integration | getfacl-absent path in-process | Set `process.env.PATH` to an empty dir in try/finally → real ENOENT → `"getfacl absent"` |
| B | CI | Both legs | Matrix above |
| C | Unit | node-on-PATH blocker/unknown/silent-pass; residual line present | Injected probe seam on `ExecutionProbeEnv` |
| C | Unit | flag matrix (7 invalid shapes + `true`/`false`/absent) | Table-driven |

## Migration / Rollout

No migration. No asset bytes, no `manifest.json` SHA, no settings identity are touched, so no
installed-state change on revert. Three chained PRs: A (~230-300) → B (~250-330) →
C (~180-260); each under the 400-line budget. B depends on A's remediation text; C is
independent of B but stacked last to keep the chain linear.

## Untouched (explicitly)

`assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs` (any edit rotates the SHA and the
settings identity), `manifest.json`, the secure-fs proof algorithms (`proveClean`,
`proveOwnershipAndMode`, `proveNoExtendedAcl`, the transaction gate/rollback), `SecureRefusal`
codes, doctor's `healthy` definition, and the win32 adapter.

## Open Questions

- [ ] Applying "invalid ⇒ true" to `disableAllHooks` as well as `allowManagedHooksOnly` — the
      doc statement is explicit only for the latter. Chosen for symmetry and fail-closure; worst
      case is a conservative false `blocked`, never a fail-open. Confirm.
- [ ] Sub-decision: init keeps status `"error"` on guard refusal (not a downgrade to `"done"`),
      with the merged preset named in the same detail. Confirm this is the wanted UX.
- [ ] Assumption to verify during apply: the installed `.mjs` runtime does not shell out to
      `getfacl` (basis for Decision 1). Grep-verify in slice A.
