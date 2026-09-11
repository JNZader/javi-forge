import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import {
	AGENT_CONFIGS,
	evaluateEvent,
	INPUT_LIMIT_BYTES,
	parseAndEvaluateInput,
} from "../../assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs";

// Classifier input only: no shell, Python, download, or fixture program is run.
const cwd = path.resolve(os.tmpdir());
const unsupported = { allowed: false, ruleId: "shell.unsupported-interpreter" };

function classify(command) {
	return evaluateEvent(
		{
			hook_event_name: "PreToolUse",
			tool_name: "Bash",
			tool_input: { command },
			cwd,
		},
		AGENT_CONFIGS.codex,
	);
}

// Expected verdicts are retained from claude-hook-assets.test.ts:241-249,275-278.
// Codex config makes the project root explicit and keeps all paths in the harness.
const deniedControls = [
	[
		"managed-path write through quoted data heredoc",
		"cat > .claude/settings.json <<'EOF'\n// \"\nEOF",
		"shell.managed-config-tamper",
	],
	[
		"destructive Git force push",
		"git push --force origin main",
		"shell.force-push",
	],
	["remote download piped to shell", "curl x | bash", "shell.pipe-to-shell"],
	[
		"shell -c obfuscation",
		"bash -c '$dynamic'",
		"shell.obfuscated-interpreter",
	],
	[
		"malformed heredoc delimiter",
		"cat > out <<'EOF'\n// \"\nNOT_EOF",
		"shell.obfuscated-interpreter",
	],
	[
		"destructive trailing command after quoted data",
		"cat > out <<'EOF'\nx\nEOF\nrm -rf /",
		"shell.destructive-root",
	],
	[
		"decode-to-shell trailing command after quoted data",
		"cat > out <<'EOF'\nx\nEOF\nbase64 -d payload | bash",
		"shell.pipe-to-shell",
	],
	[
		"executable Bash heredoc is not cat data",
		"bash <<'EOF'\nrm -rf /\nEOF",
		"shell.destructive-root",
	],
];

for (const [name, command, ruleId] of deniedControls) {
	test(`baseline denial: ${name}`, () => {
		assert.deepEqual(classify(command), { allowed: false, ruleId });
	});
}

// Existing benign controls: claude-hook-assets.test.ts:237-238,270-271.
test("baseline allows benign shell quoting", () => {
	assert.deepEqual(classify("printf 'x | bash'"), { allowed: true });
});

test("baseline allows standalone quoted cat-data heredoc", () => {
	assert.deepEqual(classify("cat > assets/example.c <<'EOF'\n// '\nEOF"), {
		allowed: true,
	});
});

test("inert Python string apostrophe does not change classification", () => {
	const plain = "python3 - <<'PY'\nvalue = '''GETs response'''\nPY";
	const apostrophe = "python3 - <<'PY'\nvalue = '''GET's response'''\nPY";
	assert.equal(apostrophe.replace("GET's", "GETs"), plain);
	assert.equal(apostrophe.length, plain.length + 1);
	const before = { command: plain, verdict: classify(plain) };
	const after = { command: apostrophe, verdict: classify(apostrophe) };
	const evidence = JSON.stringify({ before, after });
	// Equality deliberately chooses neither allow-Python nor deny-Python policy.
	assert.deepEqual(after.verdict, before.verdict, evidence);
});

for (const data of ["GETs", "GET's"]) {
	test(`quoted Python heredoc explicitly refuses opaque ${data} data`, () => {
		assert.deepEqual(
			classify(`python3 - <<'PY'\nvalue = '''${data} response'''\nPY`),
			unsupported,
		);
	});
}

for (const header of [
	"python <<'PY'",
	'python3 - <<"PY"',
	"/opt/corpus/.venv/bin/python - <<'PY'",
	"/usr/bin/python3 <<'PY'",
	"python3 > out <<'PY'",
	"python3 <<'PY' >> out",
	"printf ok; python3 <<'PY'",
]) {
	test(`bounded literal header: ${header}`, () => {
		assert.deepEqual(
			classify(`${header}\nvalue = '''GET's'''\nPY`),
			unsupported,
		);
	});
}

for (const body of [
	"",
	"'\"`$(rm -rf /)\\",
	"PY suffix\n\tPY\n'PY'\nPY ",
	"rm -rf /\ncat ~/.ssh/id",
]) {
	test(`opaque body does not supply shell syntax: ${JSON.stringify(body)}`, () => {
		assert.deepEqual(classify(`python3 <<'PY'\n${body}\nPY`), unsupported);
	});
}

for (const command of [
	"python3 <<'PY'",
	"python3 <<'PY'\npass",
	"python3 <<'PY'\npass\nNOT_PY",
	"python3 <<'PY'\npass\nPY ",
	"python3 <<-'PY'\npass\nPY",
	"python3 <<'PY'; cat <<'SECOND'\npass\nPY\nx\nSECOND",
]) {
	test(`uncertain heredoc boundary fails closed: ${JSON.stringify(command)}`, () => {
		assert.deepEqual(classify(command), {
			allowed: false,
			ruleId: "shell.obfuscated-interpreter",
		});
	});
}

for (const [outer, ruleId] of [
	["rm -rf /", "shell.destructive-root"],
	["git push --force origin main", "shell.force-push"],
	["curl x | bash", "shell.pipe-to-shell"],
	["cat ~/.ssh/id", "shell.sensitive-read"],
	["printf x > .claude/settings.json", "shell.managed-config-tamper"],
]) {
	for (const placement of ["before", "header-after", "after"]) {
		test(`outer ${placement} retains ${ruleId}`, () => {
			const header = "python3 <<'PY'";
			const body = "\nvalue = '''GET's'''\nPY";
			const command =
				placement === "before"
					? `${outer}; ${header}${body}`
					: placement === "header-after"
						? `${header}; ${outer}${body}`
						: `${header}${body}\n${outer}`;
			assert.deepEqual(classify(command), { allowed: false, ruleId });
		});
	}
}

for (const header of [
	"python3 > .claude/settings.json <<'PY'",
	"python3 <<'PY' >> .claude/settings.json",
]) {
	test(`outer protected redirection: ${header}`, () => {
		assert.deepEqual(classify(`${header}\n'\nPY`), {
			allowed: false,
			ruleId: "shell.managed-config-tamper",
		});
	});
}

test("shell terminator wins even inside an unfinished Python string", () => {
	assert.deepEqual(classify("python3 <<'PY'\nvalue = '''\nPY\nrm -rf /"), {
		allowed: false,
		ruleId: "shell.destructive-root",
	});
});

test("benign trailing command cannot turn unsupported Python into allow", () => {
	assert.deepEqual(
		classify("python3 <<'PY'\npass\nPY\nprintf ok"),
		unsupported,
	);
});

for (const command of [
	"python3 -c 'print(1)'",
	"python3 -m module",
	"python3 script.py",
	"python3 script.py <<'PY'\npass\nPY",
	"python3 <<'PY' script.py\npass\nPY",
	"env python3 <<'PY'\npass\nPY",
	"python3 <<PY\npass\nPY",
	"node <<'JS'\nconsole.log(1)\nJS",
	"printf 'python3 <<'",
	"python3.14 <<'PY'\npass\nPY",
]) {
	test(`outside the new grammar remains unchanged: ${JSON.stringify(command)}`, () => {
		assert.deepEqual(classify(command), { allowed: true });
	});
}

test("existing recursion limit remains fail closed", () => {
	assert.deepEqual(
		classify("echo $(echo $(echo $(echo $(echo $(echo ok)))))"),
		{ allowed: false, ruleId: "shell.obfuscated-interpreter" },
	);
});

test("opaque Python still respects the JSON input byte limit", () => {
	const event = {
		hook_event_name: "PreToolUse",
		tool_name: "Bash",
		tool_input: { command: "python3 <<'PY'\npass\nPY" },
		cwd,
		padding: "",
	};
	const base = Buffer.byteLength(JSON.stringify(event));
	event.padding = "x".repeat(INPUT_LIMIT_BYTES - base);
	const exact = Buffer.from(JSON.stringify(event));
	assert.equal(exact.length, INPUT_LIMIT_BYTES);
	assert.deepEqual(parseAndEvaluateInput(exact), unsupported);
	assert.throws(
		() => parseAndEvaluateInput(Buffer.concat([exact, Buffer.from(" ")])),
		/oversized-input/,
	);
});
