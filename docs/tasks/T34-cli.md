# T34 — CLI (optional)

Part of the [roadmap](../roadmap.md). Phase 3 · wave 8 · size M.

- **Depends on:** [T25](T25-public-api-release.md)

## Goal

`@callis/cli` with:

- `callis eval '<expr>' file.json [--model r4|r5] [--typed] [--var name=value]`
- `callis parse '<expr>'` (prints the AST)
- `callis check '<expr>' --type Patient` (runs the analyzer)

## Acceptance criteria

Works through `npx`; output is JSON or human-readable; errors are formatted with a source excerpt; exit codes are documented.
