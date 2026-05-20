/**
 * `javi-forge skill publish [dir]` handler.
 *
 * Console-only (no Ink, no React, no CIContextProvider).
 * Lazy-loads ../../lib/skill-publish.js INSIDE the function to preserve
 * cold-start performance — heavy command modules MUST NOT be eager-imported
 * at the top of this file.
 *
 * The case label in src/index.tsx is `"skill"` (with `publish` as the only
 * supported subcommand); the handler is named `handleSkillPublish` for clarity
 * since "skill" alone is ambiguous next to the `skills` command group.
 */

import path from "node:path";
import type { Result } from "meow";
import type { FLAGS_SCHEMA } from "../help.js";

type CLI = Result<typeof FLAGS_SCHEMA>;

export async function handleSkillPublish(cli: CLI): Promise<void> {
	const skillAction = cli.input[1] as string | undefined;

	if (skillAction !== "publish") {
		console.error("Usage: javi-forge skill <publish>");
		console.error(
			"  publish  Package a skill directory for marketplace distribution",
		);
		process.exit(1);
	}

	const targetDir = cli.input[2] ?? process.cwd();
	const { publishSkill } = await import("../../lib/skill-publish.js");
	const result = await publishSkill({
		skillDir: path.resolve(targetDir),
		author: cli.flags.author || undefined,
		repository: cli.flags.repo || undefined,
		dryRun: cli.flags.dryRun,
	});

	if (result.success) {
		console.log(
			`\u2713 Published: ${result.manifest?.name}@${result.manifest?.version}`,
		);
		console.log(`  plugin.json: ${result.pluginJsonPath}`);
		if (result.manifest?.tags?.length) {
			console.log(`  tags: ${result.manifest.tags.join(", ")}`);
		}
		if (cli.flags.dryRun) {
			console.log("  (dry-run: no files written)");
		}
	} else {
		console.error(`\u2717 ${result.error}`);
		process.exit(1);
	}
}
