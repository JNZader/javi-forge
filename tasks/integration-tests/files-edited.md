## Files Changed — integration-tests

### Task 1: Test helpers
- `src/__integration__/helpers.ts` — createTempDir, cleanupTempDir, readGenerated, fileExists, getFileMode, collectSteps

### Tasks 2-3, 5-6, 10: Init integration tests
- `src/__integration__/init.integration.test.ts` — 16 tests covering full init, content verification, ci-local, modules, cross-stack

### Task 4, 9: Template integration tests
- `src/__integration__/template.integration.test.ts` — 13 tests covering renderTemplate, generateCIWorkflow (all stack+provider combos), generateDependabotYml (all stacks)

### Task 7: CI integration tests
- `src/__integration__/ci.integration.test.ts` — 3 tests covering noDocker, detect mode, python detection

### Task 8: Plugin integration tests
- `src/__integration__/plugin.integration.test.ts` — 7 tests covering validation with real filesystem fixtures
