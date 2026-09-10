# Quoted Python heredocs are explicitly unsupported

The Bash guard refuses recognized opaque Python heredocs with
`shell.unsupported-interpreter`. This deliberately tightens the previous behavior:
both `GETs` and `GET's` inside Python string data are denied consistently.
It does not unblock the original authoring command or approve Python execution.

## Bounded grammar

- Recognition is limited to the first shell command line, including direct
  commands separated there by `;`, `|`, or `&` operators outside quotes.
- The executable is literal `python`, `python3`, or an unquoted absolute path
  ending in either name; path components contain letters, digits, `_`, `.`, `-`.
- Only the optional stdin argument `-` is accepted. Literal file redirections
  `<`, `>`, `>>` with optional numeric descriptors may precede/follow the heredoc.
  Their paths contain letters, digits, `_`, `.`, `/`, `~`, `-`; fully quoted
  paths may additionally contain spaces.
- Exactly one `<<'DELIMITER'` or `<<"DELIMITER"` uses an identifier delimiter
  (`[A-Za-z_][A-Za-z0-9_]*`). Its closing line must match exactly, even if that
  line appears inside a Python string. EOF immediately after it is accepted.
- Missing/wrong terminators, multiple documents on that header, and recognized
  `<<-` tab-stripping forms fail closed as `shell.obfuscated-interpreter`.

The body is never shell-lexed or executed. Header redirections, preceding/header
commands, and text after the real terminator remain subject to existing shell
rules. Known prohibited outer operations retain their existing rule IDs before
the final unsupported verdict; harmless outer commands cannot make Python allowed.

## Limits and transport

Other forms retain their existing behavior: Python `-c`, `-m`, script files,
wrappers, other interpreters, unquoted delimiters, later command-line headers,
and syntax outside the bounded grammar. This is not a general shell/Python parser
or a guarantee that these other forms are safe. Existing shell-interpreter body
treatment, recursion limits, and the 1 MiB JSON input limit remain in force.

Transport remains silent exit 0 for allowed inputs, or exit 2 with bounded stderr.
The unsupported diagnostic is fixed and contains no submitted code or paths.
There is no prompt, approval token, override, or live activation in this change.
