# T0 — Repository scaffold

Part of the [roadmap](../roadmap.md). Phase 0 · wave 0 · size M.

- **Depends on:** –
- **Parallel with:** –
- **Background:** [ADR-0009](../adr/0009-esm-only-zero-deps.md), [ADR-0010](../adr/0010-tooling.md)

## Goal

A working pnpm monorepo where every later task can add code and tests without touching the tooling.

## Scope

- **Root workspace:**
  - `package.json`: private, `packageManager` pinned to the current pnpm major, `engines.node >= 22`
  - scripts: `build`, `test`, `test:watch`, `typecheck`, `lint`, `format`, `check` (lint + typecheck + test + build + package checks) and `changeset`
  - `pnpm-workspace.yaml` (`packages/*`, `tools/*`), `.node-version` (24), `.editorconfig`, `.gitignore`
  - a `LICENSE` file (MIT); the README says MIT, but the file is missing
- **TypeScript 7:** `tsconfig.base.json` with the flags from [build and packaging](#build-packaging-and-runtime-targets) (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedDeclarations`), per-package `tsconfig.json`, `typecheck` with `tsc --noEmit`.
- **Build:** [tsdown](https://tsdown.dev) in `packages/core`, producing ESM `dist/index.js` and `dist/index.d.ts`. Pin the tsdown version (it is still 0.x).
- **Tests:** Vitest with `projects` (one per package), a smoke test in core, and coverage (`@vitest/coverage-v8`) configured but not enforced.
- **Lint/format:** [Biome](https://biomejs.dev) with `biome.json`. `biome ci` runs in CI.
- **Package checks:**
  - `publint`
  - `@arethetypeswrong/cli`
  - a script that fails if `@callis/core` has any `dependencies`
  - a script that reports the gzip size of `@callis/core`
- **Versioning:** Changesets (`.changeset/config.json`, independent versions, `access: public`).
- **CI:** `.github/workflows/ci.yml` runs on push and pull request:
  - `pnpm install --frozen-lockfile`
  - `biome ci`
  - typecheck
  - tests on Node 22, 24 and 26
  - build
  - package checks

  Concurrent runs on the same ref are cancelled.

- **`packages/core`** (`@callis/core`):
  - `package.json` with `version: 0.0.0`, `type: module`, an `exports` map, `files`, `sideEffects: false`, `engines`, `license`, `repository` and `keywords`
  - `src/index.ts` with an **empty public API**
  - an internal `src/errors/` skeleton: the `FhirPathError` hierarchy, `SourceSpan`, the `ErrorCode` union and `format()` from [errors and diagnostics](#errors-and-diagnostics). Every wave-1 task needs this module, so it is created here to avoid merge conflicts.
- **`CONTRIBUTING.md`:** commands, branch and PR conventions (task IDs, Conventional Commits), how to add a changeset, and links to the docs.

## Out of scope

Any FHIRPath functionality; the release workflow (T25).

## Design notes

### Errors and diagnostics

```ts
class FhirPathError extends Error {
  readonly code: ErrorCode;          // stable string, e.g. 'syntax/unexpected-token'
  readonly span?: SourceSpan;
  readonly expression?: string;
  format(): string;                  // message plus source excerpt with a caret
}
class FhirPathSyntaxError extends FhirPathError {}
class FhirPathSemanticError extends FhirPathError { readonly diagnostics: readonly Diagnostic[] }
class FhirPathEvaluationError extends FhirPathError {}

interface SourceSpan { start: number; end: number; line: number; column: number } // offsets in UTF-16 units; line/column 1-based
```

Error codes are stable strings grouped by stage, for example:

- **syntax:** `syntax/unexpected-token`, `syntax/unterminated-string`, `syntax/invalid-escape`, `syntax/invalid-date-literal`
- **semantic:** `semantic/unknown-function`, `semantic/wrong-arity`, `semantic/unknown-element`, `semantic/unknown-type`
- **evaluation:** `eval/singleton-expected`, `eval/type-mismatch`, `eval/undefined-variable`, `eval/invalid-literal`, `eval/async-in-sync`, `eval/aborted`, `eval/limit-exceeded`

A formatted error looks like this:

```text
FhirPathSyntaxError [syntax/unexpected-token]: Expected ')' but found end of input
  Patient.name.where(use = 'official'
                                     ^
```

When the spec says evaluation "will end and signal an error to the calling environment", Callis throws. When it says the result is empty, Callis returns `[]`; division by zero is one example.

### Build, packaging and runtime targets

| Topic | Decision |
| --- | --- |
| Module format | **ESM only** (`"type": "module"`, an `exports` map with `types` + `default`, `"sideEffects": false`). Node ≥ 20.19 / 22.12 can `require()` ESM. See [ADR-0009](../adr/0009-esm-only-zero-deps.md) and the open questions. |
| Language target | ES2022 output. `BigInt` is the only feature newer than ES2017 that is essential. |
| Platform independence | The core imports no `node:` modules and uses no `Buffer`, `process` or DOM types. `lib` is `ES2022` only. Host APIs that appear in the public API are typed with small structural interfaces defined and exported by the core, for example `CancellationSignal` instead of `AbortSignal` ([T21: sync and async](T21-hooks-async.md#sync-and-async)), so consumers need no extra ambient typings. |
| Runtimes | Node.js 22, 24 and 26 (current LTS lines); evergreen browsers; Deno, Bun and edge workers on a best-effort basis. `engines.node: ">=22"`. |
| TypeScript | TypeScript 7 (native compiler) with `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` and `isolatedDeclarations`. The last one forces explicit types on the public API and enables fast `.d.ts` generation. |
| Build | [tsdown](https://tsdown.dev) (Rolldown-based; tsup is no longer maintained and points users to tsdown). Outputs ESM plus `.d.ts`. |
| Lint and format | [Biome](https://biomejs.dev): one tool, fast, minimal config. Type checking is a separate `tsc --noEmit` step. |
| Tests | [Vitest](https://vitest.dev), with one project per package. |
| Versioning | [Changesets](https://github.com/changesets/changesets), independent versions per package. Model and UCUM packages have a peer dependency on `@callis/core`. |
| Package checks | `publint` and `@arethetypeswrong/cli` in CI. A script fails the build if `@callis/core` gains any `dependencies`. Bundle size is tracked, with an initial budget of 40 kB gzip for the core. |
| CI (GitHub Actions) | Install (pnpm, frozen lockfile), `biome ci`, typecheck, unit tests (Node matrix), build, package checks, conformance report (job summary + artifact). A release workflow based on changesets comes with the first release. |

## Acceptance criteria

- [ ] On a clean clone, `pnpm install && pnpm check` passes on Node 22, 24 and 26.
- [ ] CI runs on every PR and is green. Breaking lint, types or tests turns it red (checked once, by hand).
- [ ] `pnpm --filter @callis/core build` emits ESM + `.d.ts`. publint and attw report no problems.
- [ ] Adding a dependency to `@callis/core` makes the no-dependency check fail (checked once, by hand).
- [ ] `pnpm changeset` works.
- [ ] The README links to `docs/` and `CONTRIBUTING.md`.



---
