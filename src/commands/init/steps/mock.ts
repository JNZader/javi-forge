import path from "node:path";
import fs from "fs-extra";
import { report } from "../report.js";
import type { StepFn } from "../types.js";

// Mock environment template — written verbatim to .env.example and .env
// when mock-first mode is enabled. Preserved byte-for-byte from init.ts baseline.
const envExample = `# Mock environment — no real API keys required
# Copy to .env to use: cp .env.example .env

# Database
DATABASE_URL=postgresql://mock:mock@localhost:5432/mock_db

# Auth
JWT_SECRET=mock-jwt-secret-for-local-development
SESSION_SECRET=mock-session-secret

# External APIs (mock mode — no real calls)
MOCK_MODE=true
API_KEY=mock-api-key-not-real
STRIPE_KEY=sk_test_mock_not_real
SENDGRID_KEY=SG.mock_not_real

# Feature flags
ENABLE_ANALYTICS=false
ENABLE_EMAILS=false
ENABLE_WEBHOOKS=false
`;

/**
 * Step 10: Configure mock-first mode.
 *
 * - When options.mock is false, reports "skipped".
 * - Otherwise writes .env.example (and .env from it) with mock values, only if
 *   the targets do not already exist.
 * - Errors are swallowed and reported as status:"error" — never thrown.
 *
 * Extracted VERBATIM from src/commands/init.ts (PR 3 of 6).
 */
export const stepMock: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep, options } = ctx;
	const stepId = "mock";
	if (options.mock) {
		report(onStep, stepId, "Configure mock-first mode", "running");
		try {
			if (!dryRun) {
				const envExamplePath = path.join(projectDir, ".env.example");
				if (!(await fs.pathExists(envExamplePath))) {
					await fs.writeFile(envExamplePath, envExample, "utf-8");
				}

				// Create .env from example
				const envPath = path.join(projectDir, ".env");
				if (!(await fs.pathExists(envPath))) {
					await fs.writeFile(envPath, envExample, "utf-8");
				}
			}
			report(
				onStep,
				stepId,
				"Configure mock-first mode",
				"done",
				".env.example + .env with mock values",
			);
		} catch (e) {
			report(onStep, stepId, "Configure mock-first mode", "error", String(e));
		}
	} else {
		report(
			onStep,
			stepId,
			"Configure mock-first mode",
			"skipped",
			"not selected",
		);
	}
};
