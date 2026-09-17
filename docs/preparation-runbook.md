# Preparation operator runbook

This runbook covers the currently shipped preparation operator workflow. It is
deliberately **diagnostic and approval-oriented**: the shipped CLI can write a
config template, measure a pinned runtime, compute a binding, prepare the exact
approval message, verify approval evidence, revoke approval evidence, and run
`preparation execute` (consume once + pinned worker). Execute still has no
destination override, model call, deploy, publish, or release. If the policy
destination already exists, execute refuses before consume.

## Safety invariant

Unless a future separately reviewed production execution route is added, the
preparation CLI must preserve these boundaries:

- no worker execution;
- no generated-helper execution;
- no output staging;
- no private-key access or signing;
- no model call, gateway call, deploy, publish, or release;
- no OpenCode runtime call from the `status-ok` validator;
- no approval consumption.

`approval-revoke` is the only command in this runbook that writes state. Its
only intended write is the bounded `revoked` terminal marker in the configured
operator-owned state directory.

## Operator-owned inputs

The operator owns these files and values:

| Input | Source | Notes |
| --- | --- | --- |
| Preparation config | `preparation template` output, then manually filled | Contains pinned worker/source/launcher digests, public key, state directory, cwd, and destination. Never contains a private key. |
| Outputs JSON | `preparation outputs-template` output, then manually filled | Used only to compute the approval binding. Payload contents are not printed by the CLI. |
| Private signing key | External signer only | `javi-forge` never reads it and never signs. |
| Approval evidence | External signer output | Bounded JSON envelope consumed by `approval-check` or `approval-revoke`. |

## Happy-path sequence

1. Generate the config skeleton:

   ```bash
   javi-forge preparation template --output preparation.config.example.json
   ```

2. Generate the outputs skeleton:

   ```bash
   javi-forge preparation outputs-template --output preparation.outputs.example.json
   ```

3. Fill a real config as `preparation.config.json` and real outputs as
   `preparation.outputs.json`.

   The compiled policy can be printed without reading any operator files:

   ```bash
   javi-forge preparation policy --json
   ```

   Use the digest helper to fill pinned digest fields without printing file
   contents:

   ```bash
   javi-forge preparation digest --file /usr/bin/bwrap --json
   ```

   Verify every pinned path and digest externally before trusting it. The public
   key must be Ed25519. The state directory and control directory must be owned
   by the current user and mode `0700`.

   The outputs template contains exactly the six supported output keys with
   empty-string values. Fill those values externally; do not treat the template
   as generated helper code.

4. Run the preflight:

   ```bash
   javi-forge preparation preflight --config preparation.config.json --json
   ```

   Continue only when the result is `status: "ready"`. `denied` means the
   operator input or filesystem boundary is unacceptable. `unavailable` means a
   measured runtime prerequisite is not currently usable.

5. Compute the approval binding:

   ```bash
   javi-forge preparation bind \
     --config preparation.config.json \
     --outputs preparation.outputs.json \
     --json
   ```

   Record the returned binding. Do not edit the config, outputs, worker,
   source, launcher, cwd, or destination between binding and approval.

6. Prepare the exact external-signing message:

   ```bash
   javi-forge preparation approval-message --binding <binding> --json
   ```

   The returned message is the exact domain-separated string to sign. It is not
   a signature and it is not an authorization by itself.

7. Sign externally.

   The external signer must return approval evidence that contains exactly the
   signed payload and signature. Do not copy private keys into this repository,
   the preparation config, or any javi-forge state file.

8. Verify the approval evidence without consuming it:

   ```bash
   javi-forge preparation approval-check \
     --config preparation.config.json \
     --binding <binding> \
     --approval preparation.approval.json \
     --json
   ```

   A ready result proves the evidence matches the binding, is within the
   configured lifetime, and has not been terminally consumed or revoked.

   To avoid copying the binding between two read-only checks, use the combined
   readiness gate:

   ```bash
   javi-forge preparation readiness \
     --config preparation.config.json \
     --outputs preparation.outputs.json \
     --approval preparation.approval.json \
     --json
   ```

   `readiness` recomputes the binding from config plus outputs and verifies the
   approval evidence against that computed binding. It does not consume the
   approval, execute the worker, stage outputs, sign, call a model, deploy,
   publish, or release.

9. Optionally validate a previously captured OpenCode status-ok response:

   ```bash
   javi-forge preparation status-ok \
     --file opencode-status-ok.json \
     --session ses_example \
     --json
   ```

   `status-ok` is a local parser only. It reads one bounded capture file and
   verifies the fixed source-only `{"status":"ok"}` StructuredOutput envelope
   for the supplied session id. It does not contact OpenCode, call a model, read
   credentials, verify or consume approval evidence, execute the worker, stage
   outputs, deploy, publish, or release.

## Revocation sequence

Use revocation when an approval should be burned before any future execution
route can consume it:

```bash
javi-forge preparation approval-revoke \
  --config preparation.config.json \
  --binding <binding> \
  --approval preparation.approval.json \
  --json
```

Expected result:

- `status: "ready"`;
- bounded approval metadata only (`nonce`, `issuedAt`, `expiresAt`);
- `terminal: "revoked"`.

After revocation, `approval-check` for the same evidence must fail with
`reason: "approval-denied"`.

## Failure handling

| Failure | Meaning | Safe response |
| --- | --- | --- |
| `invalid-config` | Config JSON shape, keys, or digests are malformed. | Regenerate from the template and re-fill; do not patch around the parser. |
| `policy-mismatch` | Config cwd/destination differs from the shipped fixed policy. | Stop. This release does not support arbitrary production destinations. |
| `public-key-unavailable` | Public key is absent, malformed, or not Ed25519. | Replace with the intended operator public key. |
| `state-directory-unsafe` | Approval state directory is not within the supported trust boundary. | Recreate as an operator-owned `0700` local directory. |
| `control-directory-unsafe` | The fixed runtime directory is not within the supported trust boundary. | Fix ownership/mode before proceeding. |
| `destination-present` | Non-overwrite destination already exists. | Inspect manually; do not overwrite through preparation. |
| `destination-unsafe` | Destination state is symlinked or otherwise unsafe. | Stop and inspect manually. |
| `approval-denied` | Evidence failed validation, expired, mismatched binding, or nonce already terminal. | Generate a new binding/approval if appropriate. Never delete terminal files to retry. |
| `worker-executable-unavailable` | Pinned worker executable is absent, unreadable, malformed, oversized, empty, or digest-mismatched. | Re-measure the intended pinned worker executable; do not substitute an unreviewed worker. |
| `worker-source-unavailable` | Pinned worker source is absent, unreadable, oversized, empty, or digest-mismatched. | Re-measure the reviewed worker source and keep it paired with the executable pin. |
| `worker-executable-unsupported` | Worker executable digest matches, but the binary is not the supported static Linux x86-64 ELF shape. | Replace with the reviewed static worker build; do not use a dynamic binary. |
| `launcher-unavailable` | Pinned launcher is absent, unreadable, digest-mismatched, group/world-writable, or not root-owned. | Repair the system launcher ownership/mode or run on a host where the launcher satisfies the trust boundary. |
| `runtime-unavailable` | A runtime measurement failed outside the more specific categories above. | Re-measure and repair operator-owned pins; do not weaken checks. |

## Rollback

There is no activation state to roll back for the current CLI runbook. To undo
operator-local preparation artifacts:

1. Preserve terminal ledger files for audit; do not delete consumed/revoked nonce
   records to reopen an approval.
2. Remove untrusted local config/output/approval scratch files.
3. If a template was generated in the wrong location, delete only that template
   file after confirming it contains no private key or approval evidence.

Code rollback for this feature remains normal source-control rollback of the
preparation files and docs. The shipped commands do not install hooks, modify
global config, or activate a production execution route.
