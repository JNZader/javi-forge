---
name: ci-local
description: Run CI pipeline locally before pushing
category: git
---

# /ci-local

Run your GitHub Actions CI pipeline locally before pushing, using `act` or `wrkflw`. Catches failures fast without burning CI minutes.

## Usage

`/ci-local [workflow-file]`

- No argument: detects and runs the default push workflow
- With file: runs the specified workflow (e.g., `/ci-local ci.yml`)

## Steps

1. **List available workflows**
   ```bash
   ls .github/workflows/
   ```

2. **Check for local CI tools**
   ```bash
   which act 2>/dev/null && echo "act found" || echo "act not found"
   which wrkflw 2>/dev/null && echo "wrkflw found" || echo "wrkflw not found"
   ```

3. **Run with `act`** (if installed)
   ```bash
   act push --container-architecture linux/amd64
   # or for a specific workflow:
   act push -W .github/workflows/ci.yml --container-architecture linux/amd64
   ```

4. **Run with `wrkflw`** (if installed)
   ```bash
   wrkflw run
   # or for a specific workflow:
   wrkflw run .github/workflows/ci.yml
   ```

5. **If neither is installed** — install `act`:

   **macOS (Homebrew)**
   ```bash
   brew install act
   ```

   **Linux (apt / snap)**
   ```bash
   snap install act
   # or via script:
   curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash
   ```

   See: https://github.com/nektos/act

6. **Show pass/fail summary**
   - ✅ All jobs green → safe to push
   - ❌ Any job red → fix before pushing (`git push --no-verify` only in emergencies)

## Notes

- `act` requires Docker to be running
- Use `--container-architecture linux/amd64` on Apple Silicon to avoid platform mismatches
- First run downloads Docker images — subsequent runs are faster
- Secrets: create `.secrets` file at repo root (`KEY=value`) and pass with `act --secret-file .secrets`
