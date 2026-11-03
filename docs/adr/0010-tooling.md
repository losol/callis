# ADR-0010: Tooling: pnpm, TypeScript 7, tsdown, Biome, Vitest, changesets

- **Status:** Accepted (owner review, 2026-11-03)
- **Date:** 2026-11-03

## Context

The monorepo needs a workspace manager, compiler, bundler, linter/formatter, test runner and release tool that are fast and stay out of the way.

- **Decision:**
- pnpm workspaces (owner decision)
- TypeScript 7 for type checking
- tsdown for building
- Biome for linting and formatting, instead of ESLint + Prettier: one tool and one config, much faster, and good enough rules for a library
- Vitest for tests and benchmarks
- Changesets for versions and changelogs

## Consequences

Few tools and fast CI. Biome lacks some type-aware ESLint rules; `tsc` strictness and code review make up for it. tsdown is still 0.x, so its version is pinned and upgraded deliberately.
