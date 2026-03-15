---
name: ide-plugins
description: >
  IDE plugin concepts. Extension points, Language Server Protocol, code completion, refactoring.
  Trigger: IDE plugin, IntelliJ, VSCode extension, Eclipse plugin, LSP
tools:
  - Read
  - Write
  - Edit
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [ide, plugins, extensions, developer-tools]
  scope: ["**/ide-plugins/**"]
---

# IDE Plugin Concepts

## Plugin Architectures

### IntelliJ Platform
```
Components:
- Actions: Menu items, toolbar buttons
- Services: Application/Project-level singletons
- Extensions: Plugin extension points
- PSI: Program Structure Interface (AST)
- VFS: Virtual File System

Lifecycle:
1. Plugin loading (lazy)
2. Component initialization
3. Extension registration
4. User interaction
5. Disposal
```

### VSCode Extensions
```
Components:
- Activation Events: When to load
- Commands: User actions
- Views: Custom UI panels
- Language Support: Syntax, completion
- Webview: Custom HTML panels

API Types:
- VS Code API (editor, window, workspace)
- Language Server Protocol
- Debug Adapter Protocol
```

### Eclipse Plugins
```
Components:
- Extension Points: Plugin hooks
- Views: UI panels
- Editors: File editors
- Nature/Builder: Project configuration
- Commands: Actions

OSGi bundles for modular architecture
```

## Language Server Protocol (LSP)

```
Standard protocol for IDE features:

Client (IDE) ←→ Server (Language-specific)

Features:
- Completion
- Hover
- Go to Definition
- Find References
- Rename
- Diagnostics
- Code Actions
- Formatting

Benefits:
- One server, multiple IDEs
- Language-agnostic
- Separate processes
```

### LSP Message Types
```json
// Request: Client → Server
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "textDocument/completion",
  "params": {
    "textDocument": {"uri": "file:///path/to/file.java"},
    "position": {"line": 10, "character": 5}
  }
}

// Response: Server → Client
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "items": [
      {"label": "toString", "kind": 2, "detail": "String"},
      {"label": "equals", "kind": 2, "detail": "boolean"}
    ]
  }
}

// Notification: Server → Client (no response)
{
  "jsonrpc": "2.0",
  "method": "textDocument/publishDiagnostics",
  "params": {
    "uri": "file:///path/to/file.java",
    "diagnostics": [
      {"range": {...}, "message": "Unused variable", "severity": 2}
    ]
  }
}
```

## Common Plugin Features

### Code Completion
```
Types:
- Keyword completion
- Symbol completion (classes, methods)
- Snippet completion
- AI-powered completion

Trigger:
- After typing characters
- On explicit request (Ctrl+Space)
- After specific characters (., ::)
```

### Code Navigation
```
Features:
- Go to Definition
- Go to Type Definition
- Go to Implementation
- Find All References
- Call Hierarchy
- Type Hierarchy
```

### Quick Fixes / Code Actions
```
Triggered by:
- Diagnostics (errors, warnings)
- Cursor position
- Selection

Examples:
- Add missing import
- Implement interface methods
- Extract method
- Rename symbol
- Convert to lambda
```

### Live Templates / Snippets
```
Template:
  trigger: "sout"
  body: "System.out.println($1);"

Variables:
- $1, $2: Tab stops
- ${1:default}: Default value
- ${TM_FILENAME}: Built-in variables
```

### Inspections / Linting
```
Analyze code for:
- Errors: Syntax, type errors
- Warnings: Code smells
- Info: Suggestions

Display:
- Inline highlighting
- Problems panel
- Gutter icons
```

## APiGen Plugin Features

### Entity Generation
```
Right-click on SQL file:
  Generate > APiGen Entity

Wizard:
1. Select tables
2. Configure options (HATEOAS, soft delete)
3. Generate files
```

### Code Templates
```
Live templates for APiGen:
- apigen.controller: BaseController template
- apigen.service: BaseService template
- apigen.entity: Entity with auditing
- apigen.dto: DTO with validation
```

### Configuration Assistant
```
Smart completion for:
- application.yml (app.* properties)
- Spring Security configuration
- Database settings

Validation:
- Required properties
- Type checking
- Reference resolution
```

## Development Best Practices

```
Performance:
✅ Lazy initialization
✅ Background processing
✅ Incremental updates
✅ Caching results
❌ Blocking UI thread
❌ Heavy startup tasks

UX:
✅ Progressive disclosure
✅ Keyboard shortcuts
✅ Consistent icons
✅ Clear error messages
❌ Modal dialogs (blocking)

Compatibility:
✅ Support multiple IDE versions
✅ Graceful degradation
✅ Platform-specific features
✅ Thorough testing
```

## Distribution

```
IntelliJ:
- JetBrains Marketplace
- Plugin repository URL
- Manual installation

VSCode:
- VS Code Marketplace
- VSIX file

Eclipse:
- Eclipse Marketplace
- Update site URL
- Dropins folder
```

## Related Skills

- `ide-plugins-intellij`: IntelliJ plugin implementation
- `apigen-architecture`: Overall system architecture


