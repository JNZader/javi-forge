#!/usr/bin/env node
import { bootstrapCli } from "./cli/bootstrap.js";

const bootstrapResult = await bootstrapCli(
	process.platform,
	() => import("./cli/main.js"),
	(message) => console.error(message),
);

if (bootstrapResult.state === "unsupported-platform") {
	process.exitCode = bootstrapResult.exitCode;
}
