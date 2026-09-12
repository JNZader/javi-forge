# Quoted Python heredocs are explicitly unsupported

The Bash guard refuses recognized quoted Python heredocs with
`shell.unsupported-interpreter`. This is a refusal boundary, not an approval to
author or execute Python. The Python body is removed from shell inspection so
apostrophes and other literal Python data cannot change its classification.

## Bounded grammar

- Recognition is limited to a direct `python` or `python3` command (or an
  absolute literal path ending in either name) on the first shell command line.
- It accepts only the optional stdin argument `-`, literal file redirections,
  and one `<<'DELIMITER'` or `<<"DELIMITER"` with an identifier delimiter.
- The closing delimiter must be an exact line. Missing/wrong terminators,
  multiple documents, and `<<-` forms fail closed as
  `shell.obfuscated-interpreter`.

The guard still evaluates the non-Python shell syntax before the header and
after the real terminator. Dangerous outer operations retain their ordinary
rule IDs (for example destructive root operations, pipe-to-shell, force-push,
sensitive reads, protected config writes, dynamic substitution, and encoded
payloads) instead of being hidden by the final unsupported verdict.

## Explicit limits

This is not a general shell or Python parser. Python `-c`, `-m`, script files,
unquoted heredocs, non-Python interpreters, wrappers, and syntax outside this
bounded grammar retain their existing behavior. Quoted `cat > file <<'EOF'`
data heredocs remain governed by the separate literal-data parser.
