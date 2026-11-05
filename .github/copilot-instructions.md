# Review instructions

Callis is a FHIRPath engine for TypeScript (`@callis/core`). The general agent instructions are in `AGENTS.md`; this file adds what matters when reviewing a pull request.

## Check

- **Spec behaviour.** Behaviour matches the cited spec section. The reference is FHIRPath N1 plus the FHIR additions, with FHIRPath 3.0.0's clarifications and the pinned HL7 test suite as tie-breakers (`docs/adr/0001-spec-baseline.md`).
- **Scope.** The change matches the PR's task file in `docs/tasks/` (the `Task:` line in the description). Point out work that belongs to another task.
- **Hard rules:**
  - no runtime dependencies in `@callis/core`
  - no `eval` or `new Function`
  - no Node.js or DOM APIs in `packages/core/src`
  - input data read through own-property checks only
  - generated files are not edited by hand
- **Errors.** Library code throws `FhirPathError` subclasses with stable codes. Spec cases that say "empty" return an empty collection instead of throwing.
- **Async.** Promises are detected structurally (`isThenable`), not with `instanceof Promise`. Lambda and host functions are tested in sync and async mode.
- **Tests.** Tests cite spec anchors or HL7 test names, assert on error codes rather than messages, and use no real clock, timezone or network. The conformance baseline does not go down.
- **Public API.** Changes have TSDoc and a changeset. New API leaves room for later tasks (optional members, options objects, extensible unions). A breaking change has `!` in the title and states its reason and the alternatives considered under *Interface changes* (`CONTRIBUTING.md`, "API changes").
- **PR title.** It follows Conventional Commits with the types and scopes listed in `CONTRIBUTING.md`. Package changes need a package scope; repository-wide `docs`, `build`, `ci` and `chore` changes may omit it (for example `docs: add contributing guidelines`).

## Do not flag

- Decisions recorded in `docs/adr/`, unless the PR contradicts them. Examples: own `Decimal`, closure compilation, ESM only, UTC as default timezone, strict choice types.
- Interpretations recorded in `docs/spec-notes.md`.
- Work that a later task in `docs/roadmap.md` covers.
- Work listed under *Follow-ups* in the PR description.

## How to comment

- One issue per comment, with a concrete failing input or scenario, and the spec anchor, test name or file it concerns.
- Say whether it is a defect or a suggestion.
