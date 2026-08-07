# Mixed-Stack CI Runners

`javi-forge ci` supports hybrid repositories with more than one toolchain
(for example: a Node frontend plus a Python backend) through a versioned
runner config: `.javi-forge/ci.yaml`.

Without any config, nothing changes: single-stack repositories are
auto-detected from marker files (`package.json`, `pyproject.toml`, `go.mod`,
…) exactly as before.

## When you need a config

Auto-detection selects **one** stack using marker precedence — a root
`package.json` wins before a nested Python project is even considered. If
your checks span more than one toolchain, a single image cannot execute all
of them (the Node image has no Python/Ruff; the Python image has no
Node/Biome). That is the case for a config.

Rule of thumb:

- **One toolchain** → no config needed (auto-detection).
- **One toolchain, forced explicitly** → `--stack <stack>` (see limits below).
- **More than one toolchain** → `.javi-forge/ci.yaml` with one runner per
  toolchain.

## `--stack` override (single-stack only)

```bash
javi-forge ci --stack python
```

Forces one explicit runner for the given stack, ignoring marker files. This
is useful when detection picks the wrong stack in a single-stack repo.

**Limit**: `--stack` is insufficient for hybrid repositories — it can only
ever select one stack. Hybrid repos must use `--config`. Combining
`--stack` and `--config` is rejected as ambiguous.

## Configuration reference

`javi-forge ci` loads the first of:

1. `--config <path>` (explicit)
2. `.javi-forge/ci.yaml` (discovered)
3. `.javi-forge/ci.yml` (discovered)

Full annotated example:

```yaml
version: 1                    # required, must be the number 1
runners:                      # required, non-empty, executed in this order
  - name: backend             # unique, docker-tag-safe ([a-zA-Z0-9._-])
    stack: python             # node|python|go|rust|java-gradle|java-maven|elixir
    directory: backend        # working dir, relative to repo root (default ".")
    image: python:3.12-slim   # optional explicit image (see pinning below)
    setup: pip install -r requirements.txt   # string or list; runs first
    lint: ruff check .
    test: pytest
    security: bandit -r .     # optional; only in full mode
    requires: [python3, ruff, pytest]        # fail-closed tool checks

  - name: frontend
    stack: node
    directory: .
    setup: pnpm install --frozen-lockfile
    lint: pnpm run lint
    build: pnpm run build     # "build" = build commands (see build-context)
    test: pnpm run test
    requires: [node, pnpm]
```

Field semantics:

| Field | Required | Notes |
|-------|----------|-------|
| `name` | yes | Unique per config; used in step ids (`lint:backend`) and as the docker tag for `build-context` images |
| `stack` | yes | Selects the default image and default commands |
| `directory` | no | Must stay inside the repo root (no `..`, no absolute paths) |
| `image` | no | Explicit image; mutually exclusive with `build-context` |
| `build-context` | no | Directory with its own `Dockerfile`; mutually exclusive with `image` |
| `setup` / `lint` / `build` / `test` / `security` | no | String or list of strings. Omitted phases fall back to the stack defaults (`lint`/`build`/`test`); `setup`/`security` default to none |
| `requires` | no | Plain tool names only (no spaces or shell metacharacters) |

Validation is **fail-closed**: any schema violation (unknown fields, bad
version, directory escapes, duplicate names, `image` + `build-context`
together, …) aborts the run listing every problem. An invalid config is
never silently ignored.

## Custom images, digest pinning, build contexts

**Explicit image** — skips the per-stack default image entirely:

```yaml
image: python:3.12-slim
```

**Digest pinning** — for reproducible CI, pin by digest; the reference is
passed to `docker run` verbatim:

```yaml
image: python:3.12-slim@sha256:0123456789abcdef...
```

**Build context** — point at a directory containing your own `Dockerfile`.
The Dockerfile is the source of truth (javi-forge never overwrites it) and
the image is rebuilt only when its content changes (hash label staleness
check), tagged `javi-forge-ci-<name>`:

```yaml
runners:
  - name: backend
    stack: python
    build-context: ./ci/docker   # must contain ./ci/docker/Dockerfile
```

A `build-context` without a `Dockerfile` fails closed with an explicit
error.

## Required tools (fail-closed)

Before any phase of a runner executes, every entry in `requires` is checked
with `command -v <tool>` **inside the runner's environment** (the container
image, or the native directory with `--no-docker`). A missing tool aborts
the whole run — it never becomes a skipped or silently-successful check:

```
✗ Missing required tool [backend]: ruff
  runner "backend": required tool "ruff" not found in image
  javi-forge-ci-python — install it in the runner image/environment or
  remove it from requires
```

## Migration guide: auto-detection → explicit config

1. Run `javi-forge ci --detect` to see the current auto-detected stack.
2. Create `.javi-forge/ci.yaml` with a single runner matching that stack
   and verify: `javi-forge ci --quick --no-docker` behaves the same.
3. Add one runner per additional toolchain, each with its own `directory`
   and `requires`.
4. Mirror what your root scripts actually invoke. If the root `lint` script
   already runs the backend's Ruff checks, prefer moving that call into the
   backend runner and keeping the frontend runner focused — each runner
   then runs in an image that has its tools.
5. Commit the config. It is versioned with the repo, so CI behavior changes
   are reviewable.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `required tool "X" not found in image …` | The runner image lacks a declared tool | Install it in the image (or `build-context` Dockerfile), or fix `requires` |
| Command exits 127 (`command not found`) | Tool used by a command but not present and not declared | Declare it in `requires` to fail earlier with a clearer error, and install it in the image |
| `build-context "…" has no Dockerfile` | Context directory without `Dockerfile` | Add one, or use `image:` instead |
| `Ambiguous CI options: --config and --stack` | Both flags passed | Use `--config` only |
| `Unknown stack "…"` | Typo in `--stack` | Valid: node, python, go, rust, java-gradle, java-maven, elixir |
| `Invalid CI config in …` | Schema violation | Read the listed `path: message` entries — all problems are reported at once |
| Backend checks silently skipped | Repo relies on auto-detection in a hybrid layout | Auto-detection is single-stack; add a config |

## Trust boundary

`ci.yaml` is a **shell execution surface**: every command in `setup`,
`lint`, `build`, `test` and `security` executes as a shell command (inside
the container, or natively with `--no-docker`). Treat config changes like
code changes:

- Only run CI on repositories whose config you trust.
- Review config changes in pull requests like any other executable change.
- javi-forge does not interpolate variables into commands and validates
  names/tools strictly, but commands themselves are executed verbatim —
  that is the intended contract.
