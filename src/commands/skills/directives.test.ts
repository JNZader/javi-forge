import { describe, expect, it } from "vitest";

import {
	detectDirectiveClash,
	extractDirective,
	subjectsSimilar,
} from "./directives.js";

// ── extractDirective ──────────────────────────────────────────────────────

describe("extractDirective", () => {
	it('extracts positive directive from "always use" rule', () => {
		const d = extractDirective("Always use strict TypeScript mode");
		expect(d).not.toBeNull();
		expect(d!.sentiment).toBe("positive");
		expect(d!.subject).toContain("strict");
	});

	it('extracts negative directive from "never use" rule', () => {
		const d = extractDirective("Never use the any type in production");
		expect(d).not.toBeNull();
		expect(d!.sentiment).toBe("negative");
		expect(d!.subject).toContain("any type");
	});

	it('extracts negative directive from "avoid" rule', () => {
		const d = extractDirective("Avoid inline styles in components");
		expect(d).not.toBeNull();
		expect(d!.sentiment).toBe("negative");
		expect(d!.subject).toContain("inline styles");
	});

	it('extracts positive directive from "prefer" rule', () => {
		const d = extractDirective("Prefer composition over inheritance");
		expect(d).not.toBeNull();
		expect(d!.sentiment).toBe("positive");
		expect(d!.subject).toContain("composition");
	});

	it("returns null for rules without clear directives", () => {
		const d = extractDirective("Components render JSX");
		expect(d).toBeNull();
	});

	it("ignores very short subjects", () => {
		const d = extractDirective("Use it");
		expect(d).toBeNull();
	});
});

// ── subjectsSimilar ──────────────────────────────────────────────────────

describe("subjectsSimilar", () => {
	it("detects similar subjects with shared words", () => {
		expect(
			subjectsSimilar(
				"arrow functions for callbacks",
				"arrow functions for callbacks",
			),
		).toBe(true);
	});

	it("detects partial overlap", () => {
		expect(
			subjectsSimilar("arrow functions callbacks", "arrow functions handlers"),
		).toBe(true);
	});

	it("rejects unrelated subjects", () => {
		expect(
			subjectsSimilar("strict typescript mode", "inline styles in components"),
		).toBe(false);
	});

	it("rejects empty subjects", () => {
		expect(subjectsSimilar("", "something")).toBe(false);
	});
});

// ── detectDirectiveClash ─────────────────────────────────────────────────

describe("detectDirectiveClash", () => {
	it("detects opposite directives on same subject", () => {
		const result = detectDirectiveClash(
			"Always use arrow functions for callbacks",
			"Never use arrow functions for callbacks",
		);
		expect(result).toBeTruthy();
		expect(result).toContain("Directive clash");
	});

	it("returns null for same-sentiment directives", () => {
		const result = detectDirectiveClash(
			"Always use TypeScript strict mode",
			"Must use TypeScript strict mode",
		);
		expect(result).toBeNull();
	});

	it("returns null for unrelated subjects", () => {
		const result = detectDirectiveClash(
			"Always use semicolons in code",
			"Never use inline styles in components",
		);
		expect(result).toBeNull();
	});
});
