# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.0] — Unreleased

### Added

- **Mixed-stack CI** — `javi-forge ci` now supports hybrid repositories via
  `.javi-forge/ci.yaml`: ordered runners, each with stack, working directory,
  image or build-context, setup/lint/build/test/security commands, and
  fail-closed required-tool checks.
- **`--config <path>`** — load an explicit mixed-runner config file.
- **`--stack <stack>` override for `ci`** — force a single explicit stack
  (single-stack repos only; insufficient for hybrid repos).
- **Deterministic build-context images** — configure `build-context` with a
  directory containing a `Dockerfile`; javi-forge builds and caches it by
  content hash.
- **Digest-pinned images** — `image: name@sha256:...` references are passed
  through verbatim to Docker.

### Changed

- `runInContainer()` no longer re-detects the stack from filesystem markers.
  The resolved runner (stack/image/build-context) is passed through the full
  call chain, eliminating caller-vs-Docker disagreements.

### Fixed

- Missing required tools no longer become skipped or silently-successful
  checks; a missing tool aborts the run with an explicit error naming the
  runner, the tool, and the image/environment.

## [1.6.0] — 2026-03-31

### Added

- **`.context/` directory generation** — `init` now generates `.context/INDEX.md` and `.context/summary.md` with stack-aware project context for AI tools
- **`CLAUDE.md` generation** — `init` generates a project-level `CLAUDE.md` tailored to the detected stack, conventions, skills, and installed modules
- **`plugin sync` command** — auto-detect installed plugins and wire them into the forge manifest
- **`plugin export` command** — export plugins to Agent Skills spec format (`skills.json`)
- **`plugin export --codex`** — export plugins to Codex-compatible TOML subagent files
- **`plugin import` command** — import Agent Skills spec packages as javi-forge plugins
- **`security baseline` command** — create a security baseline from current audit findings (supports node, python, go, rust)
- **`security check` command** — detect regressions against baseline (exits non-zero if new vulnerabilities found)
- **`security update` command** — re-snapshot baseline to acknowledge current vulnerabilities
- **`tdd init` command** — install TDD-enforcing pre-commit hook that auto-detects stack and test command
- **`skills doctor` command** — health report for installed skills with token budget analysis
- **`skills doctor --deep`** — conflict detection (contradicting critical rules) and duplicate detection (overlapping triggers)
- **`skills budget` command** — show token cost of all loaded skills with budget threshold and suggestions
- **`skills score` command** — score a skill on 4 quality dimensions (completeness, clarity, testability, token efficiency)
- **`skills benchmark` command** — structural quality checks (frontmatter, triggers, rules, code examples, sections, vague terms)
- **`llms-txt` command** — generate AI-friendly `llms.txt` with compact project notation (~75% token reduction)
- **Mock-first mode** — `init --mock` generates `.env.example` and `.env` with mock values for local development
- **CI simulation** — `ci` command runs lint + compile + test + security + ghagga with Docker support
- **CI flags** — `--quick`, `--shell`, `--detect`, `--no-security`, `--timeout`
