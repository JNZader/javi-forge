# preparation execute Specification (slice 1)

## Requirements

### Requirement: Execute consumes approval at most once

GIVEN valid config, outputs, and unused approval
WHEN `preparation execute` succeeds or fails after consume
THEN the grant cannot be consumed again and diagnostic verbs still do not consume

### Requirement: Existing destination refuses before consume

GIVEN the configured destination already exists
WHEN execute runs
THEN it fails, does not consume, and does not start the worker

### Requirement: No production destination is created

GIVEN execute runs (success or worker failure)
WHEN the process exits
THEN no production destination directory/file from operator config is created.
Cleanup removes only identities this process created.

### Requirement: Diagnostic verbs unchanged

GIVEN template/preflight/bind/readiness/status-ok/approval-check
WHEN they run
THEN they still do not execute the worker, stage outputs, or consume approval
(`approval-revoke` remains the only diagnostic write: revoked marker).
