import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		// Keep vitest out of agent worktrees under .claude/worktrees — the default
		// discovery sweeps them and a plain `pnpm test` picks up phantom copies of
		// the suite from unrelated in-flight branches.
		exclude: [...configDefaults.exclude, "**/.claude/**"],
		environment: "node",
		pool: "forks",
		// CI runs the suite inside the Javi forge runner container as the `runner`
		// user (uid 1001) while node_modules is host-owned (uid 1000): vitest's
		// default cacheDir under node_modules/.vite-temp cannot be written there
		// (EACCES on the config timestamp). Point the cache at /tmp so the suite
		// is runnable in the container without root-owned artifacts.
		cacheDir: "/tmp/vitest-javi-forge",
		testTimeout: 30_000,
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts", "src/**/*.tsx"],
			exclude: ["src/index.tsx", "src/ui/**", "src/e2e/**"],
			thresholds: { lines: 85, branches: 80 },
		},
	},
});
