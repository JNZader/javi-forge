# Preparation source slice — disconnected, partial

No hook, CLI, configuration, production key, or real preparation destination is
activated. The interpreter prohibition is unchanged. `inspectAuthorization`
returns `runtime-unavailable` **before contacting or consuming an authority**;
an absent authority returns `authorization-unavailable`.

## Implemented and tested

- Exact fixed cwd, destination, six names and empty ambient inputs. Immutable
  strings and five identity claims are bound to the complete policy with SHA-256.
  These identity claims are not yet measurements of a production runtime.
- An explicitly configured **Ed25519 public key**, never a private key, verifies
  domain-separated canonical operator evidence. Exact binding, nonce, purpose,
  maxUses=1, issued time and expiry (at most ten minutes) are checked.
- Verification is read-only. Low-level consume/revoke primitives compete for the
  same exclusive terminal inode on a trusted Linux local filesystem. Creation,
  file fsync and directory fsync precede success. A partial failure never deletes
  the terminal inode or reopens the nonce. Revocation before consumption wins;
  revocation is not a process-cancellation mechanism after consumption wins.
- The terminal record is a bounded sanitized audit (`consumed` or `revoked` only),
  0600 inside an existing operator-owned 0700 state directory. No evidence,
  credentials, payload or error detail is stored. Retain terminal files permanently.
- The data-only stager uses pinned directory descriptors via `/proc/self/fd`,
  exclusive creation, no caller path names, six output strings, an aggregate 1 MiB
  limit and 0700/0600. It never imports, interprets or runs helper bytes.
- Its only exposed staging entrypoint creates its **own random temporary fixture
  root**. There is no production destination override or production staging route.
  Partial failure cleanup removes only identities it created, never recursively
  following a replaced destination. Unknown replacement state is preserved.

Tests include real temporary files, actual fixture Ed25519 signatures, two
competing local processes, replay/revocation, mode/symlink checks, mid-write
ancestor replacement, and injected disk-write failure cleanup. They issue no real
operator grant and never access the fixed production destination.

## Trust boundary and remaining work

The root account, effective UID, monotonic operation of the wall clock, procfs and
local filesystem durability are trusted. Foreign-writable ancestors are refused;
a root-owned sticky ancestor such as `/tmp` is allowed. The final controlling
and state directories must be owned by the effective UID and exactly 0700.
Hostile same-UID processes, root compromise and network filesystems are outside
this supported boundary. Descriptor tests do not prove security against them.

This slice now includes a **disconnected executor fixture** and a pinned native
worker. The executor verifies the fixed policy binding, compares observed
code/dependency/executable/configuration/destination identities, consumes the
approval immediately before work, runs the worker with bounded stdio and
timeouts, checks the worker's structured preparation result, stages bounded
outputs, and records a bounded execution audit. The worker fixture provides the
no-network/no-credential Linux namespace boundary used by the tests.

That executor is still **not a production route**. No hook, CLI, configuration,
production key, production destination, or arbitrary helper execution is wired to
it. Its fixture identities are test-only claims, not deployment measurements.
The top-level availability route remains unavailable, and this slice does not
authorize running generated preparation helpers.

This source now also exposes a read-only **production preflight contract**. It
parses an exact operator configuration, checks the configured cwd/destination
against the expected policy, validates an Ed25519 public key, verifies the
operator-owned state/control directories, confirms the destination is absent for
the non-overwrite run, and measures the pinned worker/source/launcher digests.
It returns only bounded statuses and reason codes (`ready`, `unavailable`, or
`denied`). It does not execute the worker, stage outputs, verify or consume an
approval, contact a model, or authorize production helper execution.
The CLI exposes this as `javi-forge preparation preflight --config <file>
[--json]`; it is diagnostic only and shares the same no-execution/no-consumption
boundary.
The CLI also exposes `javi-forge preparation template --output <file>` to write
the exact JSON skeleton an operator can fill before preflight. It writes only the
template, refuses overwrite unless `--force` is explicit, and includes no private
key, approval evidence, model credential, generated artifact, or production
execution path.
`javi-forge preparation outputs-template --output <file>` writes the exact
six-output JSON skeleton an operator can fill before binding. It writes only the
template, refuses overwrite unless `--force` is explicit, and does not stage
outputs or generate helper code.
`javi-forge preparation policy [--json]` prints the compiled fixed preparation
policy and output names without reading operator config, output files, approval
evidence, worker paths, or runtime state.
`javi-forge preparation digest --file <file> [--json]` computes a SHA-256 digest
for one bounded regular file and prints only the digest plus byte length. It
refuses empty, oversized, symlink, or non-regular files and does not print file
contents.
`javi-forge preparation bind --config <file> --outputs <file> [--json]` adds a
second read-only diagnostic step: it validates the same runtime boundary, parses
an exact six-output JSON object, and computes the approval binding an external
operator signer would sign. It does not print output payload contents and still
does not verify or consume approval evidence, execute the worker, stage outputs,
contact a model, deploy, publish, or release.
`javi-forge preparation readiness --config <file> --outputs <file>
--approval <file> [--json]` is a combined read-only gate: it recomputes the
binding from config plus outputs and verifies the approval evidence against that
computed binding. It prints only bounded binding and approval metadata, never
output payload contents or approval evidence, and it does not consume approval
evidence, execute the worker, stage outputs, call a model, deploy, publish, or
release.
`javi-forge preparation approval-message --binding <hex> [--json]` prepares the
exact domain-separated payload/message for that external signer. It can generate
a nonce and bounded validity window, but it does not read a private key, sign,
verify, consume, execute, stage, call a model, deploy, publish, or release.
`javi-forge preparation approval-check --config <file> --binding <hex>
--approval <file> [--json]` verifies operator approval evidence with the
configured Ed25519 public key and reports only bounded approval metadata. It does
not print the evidence, signature, or payload body, and it does not consume,
execute, stage, call a model, deploy, publish, or release.
`javi-forge preparation approval-revoke --config <file> --binding <hex>
--approval <file> [--json]` verifies the same evidence and writes only the
exclusive `revoked` terminal marker in the operator-owned state directory. It
does not print the evidence, signature, or payload body, and it does not execute
the worker, stage outputs, consume an approval, call a model, deploy, publish,
or release.

Remaining work is to connect this boundary through a separately reviewed
production route with real operator configuration, production identity
measurement, operator UX, packaging, install/rollback procedure, and runtime
evidence collection. No broad host mount or weaker worker is shipped as a
substitute. There is no static claim that arbitrary Python is safe.

## Verification and rollback

Run the focused `src/lib/preparation-*.test.ts` suites and the packaged hook
integration harness with the existing Vitest. The child fixtures are fixed test
code and the worker is the pinned native fixture; neither executes generated
output helpers. Remove the preparation source/tests, fixtures, worker and this
document to roll back this disconnected unit. No dependencies, installation or
production activation.
