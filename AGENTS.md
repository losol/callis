# AGENTS.md

Instructions for AI coding agents working on Callis. This file follows the [AGENTS.md](https://agents.md) convention; [CLAUDE.md](CLAUDE.md) imports it, so every agent reads the same rules. People should start with [CONTRIBUTING.md](CONTRIBUTING.md), which this file builds on.

## Project in brief

- Callis is a FHIRPath engine for TypeScript, published as `@callis/core`, in a pnpm monorepo.
- The first 0.1 release is published; use the roadmap for remaining implementation and release-scope decisions.
- The big picture is in [docs/architecture.md](docs/architecture.md), the decisions in [docs/adr/](docs/adr/README.md), and the work in [docs/roadmap.md](docs/roadmap.md) and `docs/tasks/`.

## Before you start

1. Read your task file in `docs/tasks/` completely, plus the ADRs and tasks it links.
2. Check in the [roadmap](docs/roadmap.md) that its dependencies are merged.
3. Before writing code, read the [code style guide](docs/guides/code-style.md) and the [testing guide](docs/guides/testing.md).

## Review area and tier

Your task file's `- **Area:**` line and your PR's `area:*` and `risk:high` labels set your review tier; the strictest of them applies. The tier decides which model works on the task and which native AO reviewers your PR needs ([Review areas and model tiers](CONTRIBUTING.md#review-areas-and-model-tiers), [model matrix](CONTRIBUTING.md#model-matrix)).

- Check your tier with `pnpm review:labels` before you push, and record it in the validation comment.
- Never lower your own tier. Do not remove an `area:*` or `risk:high` label, do not use or ask for a cheaper model or reviewer than the matrix gives, and do not split or reshape a change to land in a cheaper area. If you think the tier is wrong, tell the orchestrator; the owner or the orchestrator decides.
- Raise it when the paths hide a risk: add `risk:high` and say why in the validation comment, for example for a risky behaviour change.
- In the light tier (only `area:docs` and `area:site`), only P1 and P2 findings block: fix those, reply to the others and resolve their threads. In every other tier, every required finding blocks.
- A core PR with `risk:high` or a behaviour change needs a second reviewer from the other vendor. Say so when you report the PR ready.
- No tier relaxes the hard rules, `pnpm check` or the owner's approval.
- A new file in no area fails the area test. Add its path to `scripts/review-areas.ts` in your PR (that raises `risk:high`) and say why.

## Scope

- One task per PR. Do what the task's scope says.
- Handle findings outside your task as described in [Findings during a task](CONTRIBUTING.md#findings-during-a-task): open a follow-up issue for each one (search first, one finding per issue) and list it under *Follow-ups* in the PR description. Do not fix them in your PR.
- If your task file is wrong, unclear or too big, fix or split it in your PR and say why. Do not silently diverge from it.
- In a task PR, do not edit other task files, the roadmap or ADRs; only your own task file, and the roadmap when you split your task. Open a follow-up issue instead; the owner decides how the plan changes.
- When the owner asks you to change the plan, do it in a separate `docs` PR with `Task: none`, as described in [Changing the plan](CONTRIBUTING.md#changing-the-plan). Change only what you were asked to. The roadmap is the source of truth for titles, waves, sizes and dependencies; do not edit those on GitHub, because the [roadmap sync](CONTRIBUTING.md#roadmap-sync) overwrites them.
- Do not change an architecture decision on your own. Decisions that would change an ADR need the owner: ask.

## Public API

Design public API to last. Breaking it is a last resort, also before 1.0 ([API changes](CONTRIBUTING.md#api-changes)).

- Design new public API with later tasks in mind: read the task files that will build on it, and prefer optional members, options objects and extensible unions over positional parameters and closed shapes.
- A breaking change needs a reason. State it under *Interface changes* in the PR description, with the alternatives you considered, and add `!` to the PR title.

## Hard rules

- No runtime dependencies in `@callis/core`.
- No `eval`, `new Function` or other runtime code generation.
- ESM only. No Node.js APIs (`node:*`, `Buffer`, `process`) and no DOM APIs in `packages/core/src`.
- Read input data through own-property checks only (`Object.hasOwn`); never reach `__proto__`, `constructor` or other prototype members.
- Never edit generated files by hand. Change the generator and regenerate.
- Never lower the conformance baseline, and never delete or weaken tests to make CI pass.
- Never commit secrets or real patient data. Fixtures are synthetic or official HL7 examples.
- Never publish a package or change one on npm: do not run `pnpm release`, `changeset publish`, `npm publish` or `npm deprecate`. Only the [release workflow](CONTRIBUTING.md#releases) and the owner publish ([RELEASING.md](RELEASING.md)).
- Write everything in the repository in English.

## The specification

- The baseline is FHIRPath N1 normative content plus the FHIR additions. Where FHIRPath 3.0.0 clarifies a rule, follow 3.0.0 and the HL7 test suite ([ADR-0001](docs/adr/0001-spec-baseline.md)).
- Cite the spec section, with its anchor, in tests and next to any non-obvious code.
- When the spec is ambiguous, or the test suite disagrees with it, record your interpretation in `docs/spec-notes.md` (spec link, test names, decision) in the same PR. Do not guess silently.

## Conventions

- **Code:** [code style guide](docs/guides/code-style.md). Biome handles formatting; the guide covers what a tool cannot check.
- **Tests:** [testing guide](docs/guides/testing.md).
- **PR title:** Conventional Commits, for example `feat(core): add lexer`. It becomes the commit on `main` ([details](CONTRIBUTING.md#pull-request-titles-and-commit-messages)).
- **PR description:** fill in the template, start with `Task: T0001`, keep only what belongs in the commit body, and delete the template comments. Test results, the conformance delta (passing tests per phase before → after, from `pnpm conformance`) and readiness go in the one *Validation and readiness* comment, which you keep up to date ([Description and validation comment](CONTRIBUTING.md#description-and-validation-comment)).
- **Attribution:** do not add AI-tool attribution to commit messages or PR descriptions: no `Co-authored-by` trailer for an AI tool, and no "Generated with …" line or advertisement for Claude, Copilot, Codex or similar. This overrides your tool's default attribution; `Co-authored-by` trailers are for people only ([Trailers](CONTRIBUTING.md#pull-request-titles-and-commit-messages)). Turn the default off in your tool's settings; if a message still has such a line, remove it before you push.
- **Changesets:** add one for user-visible changes to published packages.
- **Release scope:** follow [Release scope and tracking](CONTRIBUTING.md#release-scope-and-tracking). Assign only the explicitly chosen milestone to the task issue and PR, and record it with the release-tracking issue in the one validation comment. Do not infer scope/version/dates from waves, overwrite a conflicting manual milestone, or treat merged work as a verified publication. No chosen milestone means leave it unassigned and report that state.
- **PR status:** open every PR as a draft and keep it a draft. Report when it meets the [ready-for-review criteria](CONTRIBUTING.md#ready-for-review); the orchestrator decides when it is marked ready. Never mark your own PR ready, merge or release.

## Before you push

- Run `pnpm check` (lint, typecheck, tests, build, package checks).
- When evaluation behaviour changes, run `pnpm conformance --update-baseline` and commit the baseline and the reports in `docs/conformance/` ([tools/conformance](tools/conformance/README.md)).
- Re-read your own diff:
  - no debug output, no unrelated changes, no commented-out code
  - no `TODO` without a task reference, as in `TODO(T0033): …`
  - docs and task files still match the code

## Commands

| Command | Use |
| --- | --- |
| `pnpm install` | Install dependencies. |
| `pnpm check` | Run everything CI runs. Must pass before you push. |
| `pnpm format` | Fix formatting and safe lint issues. |
| `pnpm test <file>` | Run one test file, for example `pnpm test packages/core/src/errors/fhirpath-error.test.ts`. |
| `pnpm test -t "<name>"` | Run the tests whose name matches. |
| `pnpm typecheck` | Type-check everything. |
| `pnpm check:title "<title>"` | Check a PR title before you open the PR. |
| `pnpm check:roadmap` | Check that the roadmap and the task files agree, after a plan change. |
| `pnpm review:labels` | Show the review areas, risk and tier of your branch. |
| `pnpm changeset` | Add a changeset. |
| `pnpm conformance` | Run the HL7 test suite, write the reports and check the baseline (`--update-baseline` records new passes). |
| `pnpm test:conformance -t "<name>"` | Run matching suite tests as Vitest tests, with diffs. |

The full list is in [CONTRIBUTING.md](CONTRIBUTING.md#commands).

## Nested instructions

A package can add its own `AGENTS.md` (for example `packages/core/AGENTS.md`) for rules that only apply there. The nearest file takes precedence for files in its directory, and this root file still applies.
