import path from "path";
import { fileURLToPath } from "url";
import type {
	HookProfile,
	StackClaudeMdEntry,
	StackContextEntry,
} from "./types/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Root of the javi-forge package (one level up from dist/) */
export const FORGE_ROOT = path.resolve(__dirname, "..");

/** Templates directory */
export const TEMPLATES_DIR = path.join(FORGE_ROOT, "templates");

/** Modules directory */
export const MODULES_DIR = path.join(FORGE_ROOT, "modules");

/** Workflows directory */
export const WORKFLOWS_DIR = path.join(FORGE_ROOT, "workflows");

/** CI-local directory */
export const CI_LOCAL_DIR = path.join(FORGE_ROOT, "ci-local");

/** Security hooks template directory */
export const SECURITY_HOOKS_DIR = path.join(TEMPLATES_DIR, "security-hooks");

/** Local AI stack template directory */
export const LOCAL_AI_TEMPLATE_DIR = path.join(TEMPLATES_DIR, "local-ai");

/** Dependabot fragment directory */
export const DEPENDABOT_FRAGMENTS_DIR = path.join(
	TEMPLATES_DIR,
	"common",
	"dependabot",
);

/** Plugins directory (installed plugins) */
export const PLUGINS_DIR = path.join(FORGE_ROOT, "plugins");

/** Plugin registry URL */
export const PLUGIN_REGISTRY_URL =
	"https://raw.githubusercontent.com/JNZader/javi-forge-registry/main/registry.json";

/** Plugin manifest filename */
export const PLUGIN_MANIFEST_FILE = "plugin.json";

/** Valid plugin asset directories */
export const PLUGIN_ASSET_DIRS = [
	"skills",
	"commands",
	"hooks",
	"agents",
] as const;

/** Agent Skills spec manifest filename */
export const AGENT_SKILLS_MANIFEST_FILE = "skills.json";

/** Stack-to-dependabot fragment mapping */
export const STACK_DEPENDABOT_MAP: Record<string, string[]> = {
	node: ["npm"],
	python: ["pip"],
	go: ["gomod"],
	rust: ["cargo"],
	"java-gradle": ["gradle"],
	"java-maven": ["maven"],
	elixir: [],
};

/** Stack-to-CLAUDE.md metadata mapping */
export const STACK_CLAUDEMD_MAP: Record<string, StackClaudeMdEntry> = {
	node: {
		skills: ["typescript", "react-19", "tailwind-4"],
		conventions: "TypeScript strict, ESM modules, functional components",
		testFramework: "vitest",
	},
	python: {
		skills: ["pytest", "django-drf"],
		conventions: "PEP 8, type hints, ruff linting",
		testFramework: "pytest",
	},
	go: {
		skills: [],
		conventions: "gofmt, golangci-lint, table-driven tests",
		testFramework: "go test",
	},
	rust: {
		skills: [],
		conventions: "cargo fmt, clippy, edition 2021+",
		testFramework: "cargo test",
	},
	"java-gradle": {
		skills: [],
		conventions: "Gradle Kotlin DSL, JUnit 5, Checkstyle",
		testFramework: "JUnit 5",
	},
	"java-maven": {
		skills: [],
		conventions: "Maven standard layout, JUnit 5, Checkstyle",
		testFramework: "JUnit 5",
	},
	elixir: {
		skills: [],
		conventions: "mix format, Credo, OTP conventions",
		testFramework: "ExUnit",
	},
	default: {
		skills: [],
		conventions: "Follow language-specific best practices",
		testFramework: "project default",
	},
};

/** Stack-to-context template mapping */
export const STACK_CONTEXT_MAP: Record<string, StackContextEntry> = {
	node: {
		tree: [
			"src/           — source code",
			"  index.ts     — entry point",
			"tests/         — test suites",
			"package.json   — dependencies & scripts",
			"tsconfig.json  — TypeScript config",
		].join("\n"),
		conventions: "TypeScript strict, ESM modules, vitest for testing",
		entryPoint: "src/index.ts",
	},
	python: {
		tree: [
			"src/           — source packages",
			"  __init__.py  — package root",
			"tests/         — pytest suites",
			"pyproject.toml — project config",
		].join("\n"),
		conventions: "PEP 8, type hints, pytest, ruff for linting",
		entryPoint: "src/__init__.py",
	},
	go: {
		tree: [
			"cmd/           — CLI entry points",
			"internal/      — private packages",
			"pkg/           — public packages",
			"go.mod         — module definition",
			"go.sum         — dependency checksums",
		].join("\n"),
		conventions: "gofmt, golangci-lint, table-driven tests",
		entryPoint: "cmd/main.go",
	},
	rust: {
		tree: [
			"src/           — source code",
			"  main.rs      — entry point",
			"  lib.rs       — library root",
			"tests/         — integration tests",
			"Cargo.toml     — manifest & dependencies",
		].join("\n"),
		conventions: "cargo fmt, clippy lints, edition 2021+",
		entryPoint: "src/main.rs",
	},
	"java-gradle": {
		tree: [
			"src/main/java/       — application source",
			"src/test/java/       — test source",
			"src/main/resources/  — config & assets",
			"build.gradle.kts     — Gradle build script",
			"settings.gradle.kts  — project settings",
		].join("\n"),
		conventions: "Gradle Kotlin DSL, JUnit 5, Checkstyle",
		entryPoint: "src/main/java/Main.java",
	},
	"java-maven": {
		tree: [
			"src/main/java/       — application source",
			"src/test/java/       — test source",
			"src/main/resources/  — config & assets",
			"pom.xml              — Maven POM",
		].join("\n"),
		conventions: "Maven standard layout, JUnit 5, Checkstyle",
		entryPoint: "src/main/java/Main.java",
	},
	elixir: {
		tree: [
			"lib/           — application source",
			"  application.ex — OTP application",
			"test/          — ExUnit tests",
			"config/        — runtime config",
			"mix.exs        — project definition",
		].join("\n"),
		conventions: "mix format, Credo, ExUnit, OTP conventions",
		entryPoint: "lib/application.ex",
	},
	default: {
		tree: [
			"src/           — source code",
			"tests/         — test suites",
			"README.md      — project documentation",
		].join("\n"),
		conventions: "Follow language-specific best practices",
		entryPoint: "src/index",
	},
};

/** Deploy template filename mapping (per CI provider) */
export const DEPLOY_TEMPLATE_MAP: Record<string, string> = {
	github: "deploy-docker-zero-downtime.yml",
	gitlab: "deploy-docker-zero-downtime.yml",
	woodpecker: "deploy-docker-zero-downtime.yml",
};

/** Deploy destination path mapping (per CI provider) */
export const DEPLOY_DESTINATION_MAP: Record<string, string> = {
	github: ".github/workflows/deploy.yml",
	gitlab: ".gitlab-ci-deploy.yml",
	woodpecker: ".woodpecker/deploy.yml",
};

/** Hook reliability profile definitions */
export const HOOK_PROFILES: Record<
	HookProfile,
	{
		label: string;
		description: string;
		hooks: string[];
	}
> = {
	minimal: {
		label: "Minimal",
		description: "pre-commit only: lint + format check",
		hooks: ["pre-commit"],
	},
	standard: {
		label: "Standard",
		description: "pre-commit + pre-push + CI gate check",
		hooks: ["pre-commit", "pre-push", "ci-gate"],
	},
	strict: {
		label: "Strict",
		description:
			"all standard + commit-msg validation + security scan on every push",
		hooks: ["pre-commit", "pre-push", "ci-gate", "commit-msg", "security-scan"],
	},
};

/** Stack-to-CI template filename mapping */
export const STACK_CI_MAP: Record<string, Record<string, string>> = {
	github: {
		node: "ci-node.yml",
		python: "ci-python.yml",
		go: "ci-go.yml",
		rust: "ci-rust.yml",
		"java-gradle": "ci-java.yml",
		"java-maven": "ci-java.yml",
	},
	gitlab: {
		node: "gitlab-ci-node.yml",
		python: "gitlab-ci-python.yml",
		go: "gitlab-ci-go.yml",
		rust: "gitlab-ci-rust.yml",
		"java-gradle": "gitlab-ci-java.yml",
		"java-maven": "gitlab-ci-java.yml",
	},
	woodpecker: {
		node: "woodpecker-node.yml",
		python: "woodpecker-python.yml",
		go: "woodpecker-go.yml",
		rust: "woodpecker-rust.yml",
		"java-gradle": "woodpecker-java.yml",
		"java-maven": "woodpecker-java.yml",
	},
};
