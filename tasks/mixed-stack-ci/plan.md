# Plan: mixed-stack-ci

## Goal

Make `javi-forge ci` support hybrid repositories with more than one toolchain
without silently skipping checks or selecting an image that cannot execute the
project's commands.

The motivating incident is Consorcio Canalero: the root `package.json` makes
javi-forge classify the repository as Node, but the root lint script also runs
the Python backend's Ruff checks. The selected Node CI image has no Python or
Ruff, so the pre-push hook fails with `ruff not found` even though Ruff passes
in the project's real Python environment.

## Confirmed Root Cause

- `detectCIStack()` selects a single stack using marker precedence. A root
  `package.json` wins before the nested Python project is considered.
- `runInContainer()` detects the stack again instead of receiving the already
  resolved runner or image.
- `javi-forge ci --stack python` is not supported; the flag is currently only
  meaningful for initialization.
- There is no repository CI configuration for ordered runners, custom images,
  working directories, or setup commands.
- The Node image intentionally contains Node/npm but not Python/Ruff.
- Choosing only Python would be equally incomplete because the repository also
  requires Node/Biome and frontend dependencies.

## Architecture Decision

Add an explicit, versioned CI configuration with one or more ordered runners.
Single-stack auto-detection remains the zero-configuration default, while
hybrid repositories declare every required runner.

Each runner must define or resolve:

- name and stack;
- working directory;
- image or Dockerfile/build context;
- dependency setup;
- lint, build, test, and optional security commands;
- required tools, validated fail-closed before execution.

The resolved runner configuration must be passed through the full call chain.
Docker execution must not re-detect the stack.

## Acceptance Criteria

- [ ] A repository can define ordered Node and Python runners in a versioned
      config such as `.javi-forge/ci.yaml`.
- [ ] Existing single-stack repositories continue to work without config.
- [ ] `javi-forge ci --stack <stack>` works for explicit single-stack
      selection, but documentation states that it is insufficient for hybrid
      repositories.
- [ ] `javi-forge ci --config <path>` loads and validates explicit runners.
- [ ] `runInContainer()` receives the resolved runner/image and never performs
      independent marker detection.
- [ ] Each runner executes in its configured working directory with its
      project dependencies available.
- [ ] Missing Python, Ruff, Node, Biome, or another declared required tool
      fails clearly and never becomes a skipped or successful check.
- [ ] A mixed fixture containing root `package.json` plus a nested Python
      project executes both runners.
- [ ] The Consorcio Canalero root lint contract can run backend Ruff and
      frontend Biome without `--no-verify`.
- [ ] Hooks continue to block a push when any configured runner fails.
- [ ] Documentation includes configuration, migration, and troubleshooting
      examples.

## Task List

| # | Task | Depends On | Status |
|---|------|------------|--------|
| 1 | Define the versioned mixed-runner config schema and validation errors | — | done (Slice A) |
| 2 | Extend CI CLI options with `--config` and a functional `--stack` override | 1 | done (Slice A) |
| 3 | Resolve auto-detected or configured runners once in `src/commands/ci.ts` | 1-2 | done (Slice A) |
| 4 | Refactor `src/lib/docker.ts` so `runInContainer()` accepts the resolved runner/image/build context | 3 | done (Slice B) |
| 5 | Add dependency setup and required-tool fail-closed checks per runner | 3-4 | done (Slice B) |
| 6 | Add Node + Python mixed-repository unit and integration fixtures | 1-5 | done (Slice C) |
| 7 | Add hook integration coverage proving a failing runner blocks push | 5-6 | done (Slice C) |
| 8 | Document single-stack overrides, mixed config, custom images, and migration | 1-7 | done (Slice C) |
| 9 | Validate the fix against Consorcio Canalero without `--no-verify` | 1-8 | pending |
| 10 | Release the fix and remove the audited incident workaround from normal workflow | 9 | pending |

## Expected Code Areas

- `src/commands/ci.ts`
- `src/lib/docker.ts`
- `src/cli/dispatch/ci.tsx`
- `src/cli/help.ts`
- CI configuration schema and loader
- Docker image/build-context selection
- Unit and integration tests
- CLI and CI documentation

## Verification

At minimum:

```bash
pnpm lint
pnpm test
pnpm build
```

Add integration coverage that:

1. creates a temporary hybrid repository;
2. installs or supplies deterministic Node and Python test toolchains;
3. runs both configured runners;
4. proves a missing Ruff executable fails;
5. proves a real Ruff pass and Node lint pass allow the hook to complete;
6. proves runner order and working directories are honored;
7. proves Docker execution uses the resolved runner instead of re-detecting
   markers.

Final external reproduction:

```bash
git push --dry-run origin HEAD
```

Run it from Consorcio Canalero with the normal pre-push hook. It must execute
backend Ruff and frontend checks successfully without `--no-verify`.

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing single-stack behavior | High | Preserve auto-detection as the default and add compatibility tests |
| Config becomes an arbitrary shell execution surface | High | Validate schema, avoid implicit interpolation, and document trust boundaries |
| Custom images are stale or non-reproducible | High | Support digest pinning and deterministic build contexts |
| Missing dependencies appear as skipped checks | Critical | Required tools and commands fail closed |
| Caller and Docker runner disagree on the stack | High | Resolve once and pass an immutable runner object |
| Hybrid CI becomes unnecessarily slow | Medium | Cache runner images/dependencies and allow ordered targeted phases |

## Temporary Incident Policy

Until this is released, `git push --no-verify` is not a routine workaround.
It is acceptable only after:

1. a normal push demonstrates the known `ruff not found` hook failure;
2. the exact HEAD and clean worktree are recorded;
3. equivalent backend/frontend checks pass independently;
4. an explicit review returns `SAFE_TO_PUSH_NO_VERIFY`;
5. the push uses an exact-SHA refspec so a later local commit cannot be
   published accidentally.

Do not fix the incident by skipping backend lint, adding `|| true`, removing
root markers, manually mutating the installed global image, or installing
tools into an ephemeral container.
