# Code style

How TypeScript is written in Callis. [Biome](https://biomejs.dev) handles formatting and the lint rules it supports (configured in [T0000](../tasks/T0000-scaffold.md)). This guide covers what a tool cannot check. When the guide and the linter disagree, fix whichever is wrong in the same PR.

## Files and modules

- **ESM only**, with **named exports only**. No default exports.
- **File names** are `kebab-case.ts`. Each file holds one main concept; tests sit next to it as `kebab-case.test.ts`.
- **No barrel files** inside `src/`. The only `index.ts` is the package entry point, which lists the public API explicitly. Internal barrels hide dependencies, create cycles and defeat tree-shaking.
- **Respect the module dependency rules** in [architecture.md](../architecture.md#repository-layout). Imports must not form cycles.
- Use `import type` and `export type` for type-only imports and exports.

## TypeScript

- **Strict compiler settings** come from `tsconfig.base.json` (T0000). Do not loosen them per file.
- **Erasable syntax only:** no `enum`, `namespace`, parameter properties or decorators. Use string-literal unions or `as const` objects instead. Code then works with plain type stripping (Node.js, Deno, bundlers) and stays easy to read.

  ```ts
  // Instead of enum Precision { Year, Month, … }
  export type Precision = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second' | 'millisecond';
  ```

- **Explicit return types on exported functions.** `isolatedDeclarations` requires them, and they document the API.
- **`unknown`, not `any`.** If `any` is unavoidable, add a comment explaining why.
- **Narrow instead of asserting.** Avoid `!` and `as`. Use `@ts-expect-error` with a reason; never `@ts-ignore`.
- **Model variants as discriminated unions** with a `kind` field, and end `switch` statements over them with an exhaustiveness check:

  ```ts
  switch (node.kind) {
    case 'Literal':
      return compileLiteral(node);
    // …one case per kind
    default:
      return assertNever(node); // compile error if a kind is missing
  }
  ```

- **`readonly`** for data that crosses module boundaries: collections, AST nodes, model data.

## Naming

- `PascalCase` for types, interfaces and classes; `camelCase` for functions, variables and constants.
- Functions are verbs (`parseDate`, `compileNode`). Booleans read as questions (`isEmpty`, `hasValue`).
- FHIRPath names keep the spec's spelling: `ofType`, `convertsToInteger`, `$this`.
- Error codes are `area/kebab-case` strings, such as `eval/singleton-expected` ([error codes](../tasks/T0000-scaffold.md#errors-and-diagnostics)).
- No abbreviations beyond the common ones (`ctx`, `expr`, `ast`, `fn`).

## Functions, data and state

- Prefer pure functions over plain data. Use classes for value types with invariants (`Decimal`, `DateTimeValue`) and for hot-path objects that benefit from a stable shape (`ModelNode`).
- Never mutate inputs or returned collections.
- No mutable module-level state. Compiled expressions must stay reentrant and safe for concurrent evaluations.
- Keep hot paths lean (avoid per-item closures and intermediate arrays), but optimize only with a benchmark to back it ([T0033](../tasks/T0033-performance.md)).

## Errors

- Library code throws only `FhirPathError` subclasses with a stable code. Never throw strings or a bare `Error`.
- When the spec says the result is empty, return an empty collection. Do not throw.
- Do not catch and swallow errors. Catch only to add context, and rethrow.
- Messages are for people: say what was expected and what was found. Tests assert on codes, not on message text.

## Async

- Follow [ADR-0004](../adr/0004-sync-core-async-path.md): use the `MaybePromise` helpers, and detect promises with `isThenable()`, never `instanceof Promise`.
- No floating promises. Every promise is awaited or returned.

## Comments and documentation

- **TSDoc on every export.** Use `@see` with a spec link for spec behaviour, and `@example` where it helps.
- **Comments explain why.** Link the spec anchor for rules that are not obvious from the code.
- No commented-out code. A `TODO` carries a task reference: `// TODO(T0033): cache type lookups`.
