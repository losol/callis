# Contributing to Callis

Callis is built task by task, mostly by AI agents working under human review. These guidelines keep the history readable and let many contributors work in parallel. They apply to people and agents alike; agents should also read [AGENTS.md](AGENTS.md).

Everything in this repository is written in English.

## Where things are

| Where | What |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | The big picture: goals, scope, pipeline, key decisions, layout. |
| [`docs/adr/`](docs/adr/README.md) | Architecture decisions and their reasons. |
| [`docs/roadmap.md`](docs/roadmap.md) | Task index, dependency graph and waves. |
| `docs/tasks/` | One file per task: goal, scope, design notes, acceptance criteria. |
| [`docs/guides/`](docs/guides/) | How to write code ([code style](docs/guides/code-style.md)) and tests ([testing](docs/guides/testing.md)). |
| `docs/spec-notes.md` | Interpretations of the FHIRPath specification (created when first needed). |

## Workflow

1. **Pick a task** from the [roadmap](docs/roadmap.md) whose dependencies are merged. One task is one pull request. Small fixes outside the task list are welcome as their own PRs.
2. **Branch** from `main`.
3. **Open a draft PR early** and fill in the template.
4. **Make it pass** `pnpm check` (see [Commands](#commands)).
5. **Mark it ready for review.** Address every review comment: fix it, or reply with the reason you did not. Resolve the thread when it is done.
6. **The owner approves and squash-merges.** Approval from an AI reviewer never replaces the owner's approval.

## Branches

- Branches are short-lived, start from `main`, and are deleted after merge.
- Name them `<task-id>-<short-description>` in lowercase, for example `t0001-lexer`. Without a task: `fix-decimal-rounding`.
- Tools that use their own branch namespace (for example `ao/…`) are fine. The PR description carries the task ID.

## Pull request titles and commit messages

PRs are **squash-merged**, so each PR becomes exactly one commit on `main`. The commit subject is the PR title (GitHub appends the PR number), and the commit body is the PR description. `git log --oneline` on `main` is therefore a list of PR titles, and the PR title is the message that matters.

PR titles follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```text
<type>(<scope>): <summary>
```

**Types**

| Type | Use for |
| --- | --- |
| `feat` | New behaviour or API. |
| `fix` | A bug fix. |
| `perf` | A performance improvement without a behaviour change. |
| `refactor` | A code change that neither fixes a bug nor adds behaviour. |
| `test` | Adding or correcting tests only. |
| `docs` | Documentation only, including ADRs and task files. |
| `build` | Build system, packaging or dependencies. |
| `ci` | CI configuration. |
| `chore` | Other maintenance that does not fit above. |
| `revert` | Reverting an earlier change. |

**Scopes** name the package or tool directory the change is about: `core`, `ucum`, `fhir-r4`, `fhir-r5`, `cli`, `conformance`, `model-gen`. The scope is optional for repository-wide `docs`, `build`, `ci` and `chore` changes. Use one scope. If a PR needs two, it is usually two PRs.

**Summary**

- Use the imperative mood: "add", not "added" or "adds".
- Start with a lowercase word, and end without a period.
- Keep the whole title at most 72 characters.
- Say what changes for someone reading `git log --oneline`. Task IDs and issue numbers go in the description, not the title.

**Breaking changes** add `!` after the type or scope and explain the migration in the description. This applies before 1.0 too.

| Good | Not good |
| --- | --- |
| `feat(core): add lexer` | `T0001 lexer` |
| `fix(core): return empty for division by zero` | `fix: fixed bug` |
| `feat(core)!: rename evaluate option output to format` | `feat(core): Breaking change in options.` |
| `docs: record UTC as default timezone` | `docs: update docs` |
| `build: pin tsdown 0.23` | `chore(deps): Bump stuff` |

**Commits on your branch** are not kept individually on `main`. Write them so a reviewer can follow the work; the same format is encouraged but not required. Do not rewrite branch history once review has started, so review comments stay attached to their lines.

**Trailers.** Credit co-authors, whether people or AI tools, with a `Co-authored-by: Name <email>` [Git trailer](https://git-scm.com/docs/git-interpret-trailers) at the end of a commit message or PR description. GitHub shows them as co-authors.

## Pull requests

- **One task per PR.** Stay within the task's scope and list anything else as a follow-up in the description.
- **Keep PRs reviewable.** If hand-written changes grow far beyond a few hundred lines, split along the task's natural seams (for example `T0008a` and `T0008b`) and update the task file. Generated files do not count.
- **Fill in the template.** The description becomes the commit body on `main`, so keep it accurate and delete the template comments. It must start with `Task: T0001` (or `Task: none`) so `git log --grep "Task: T0001"` finds the commit.
- **Reviews:** Copilot reviews every PR automatically. An AO review can be requested for implementation PRs. The owner's approval is required to merge.
- **Stay up to date** with `main` by merging it into your branch; avoid force-pushing after review has started.

## Definition of done

A PR is ready to merge when:

- the acceptance criteria in its task file are met
- `pnpm check` is green
- new behaviour has tests that cite the spec section they cover ([testing guide](docs/guides/testing.md))
- user-visible changes to a publishable package have a changeset
- the task file, `docs/spec-notes.md` and ADRs are updated where the change affects them
- the conformance baseline did not go down

## Changesets

Versions and changelogs are managed with [Changesets](https://github.com/changesets/changesets), not with commit messages.

- Add a changeset (`pnpm changeset`) for every user-visible change to a published package: behaviour, API, types or packaging. Tests, docs and internal tooling do not need one.
- Choose the bump with [SemVer](https://semver.org) in mind. Before 1.0, use `minor` for new features and breaking changes, and `patch` for fixes.
- Write the summary for users of the package: what changed, and how to migrate if they must.

## Specification questions and decisions

- **Spec baseline:** FHIRPath N1 normative content plus the FHIR additions; where FHIRPath 3.0.0 clarifies a rule, follow 3.0.0 and the HL7 test suite ([ADR-0001](docs/adr/0001-spec-baseline.md)).
- **Interpretations** that are not obvious from the spec, and test-suite labels we deliberately do not follow, go into `docs/spec-notes.md`. Each entry has the spec link, the test names and the decision, and is added in the same PR as the code.
- **Design details** live in the task file. If implementation changes them, update the task file in the same PR.
- **Architecture decisions** are changed with a new ADR that supersedes the old one, in the same PR ([ADR index](docs/adr/README.md)). Changing an ADR needs the owner's agreement.

## Documentation style

- Plain language and short sentences. Explain why, not only what.
- Headings in sentence case. Tables and lists for reference material.
- Link spec sections with anchors (`https://hl7.org/fhirpath/N1/#…`) instead of paraphrasing them at length.
- Keep examples correct; code examples in user documentation are run in CI from T0025.
- Markdown is not auto-formatted; Biome formats code and JSON only. Write tables in the compact form (`| --- |`), so a change to one row does not re-pad the whole table.

## Dependencies and licenses

- `@callis/core` has **no runtime dependencies**; CI enforces this. Other published packages avoid runtime dependencies; ask the owner before adding one.
- Dev dependencies are fine when they earn their place. Say why in the PR. Prefer well-maintained packages with MIT, ISC, BSD or Apache-2.0 licenses.
- Vendored data (test fixtures, UCUM tables, FHIR definitions) records its source, version and license next to it.
- Never commit secrets or real patient data. Fixtures are synthetic or official HL7 examples.

## Repository settings

For maintainers. These settings make the rules above hold:

- **Merging:** squash merge only. The squash commit takes the PR title as its subject and the PR description as its body. Branches are deleted automatically after merge.
- **Required checks** (once T0000 has added them): CI, and a PR-title check for Conventional Commits.
- **Approval:** the owner's approval is required.

## Commands

You need Node.js 22.18 or newer (`.node-version` pins 24 for development) and [pnpm](https://pnpm.io/installation). Any recent pnpm switches to the version pinned in `package.json` (`packageManager`) by itself.

| Command | What it does |
| --- | --- |
| `pnpm install` | Install dependencies. |
| `pnpm check` | Everything CI runs: lint, typecheck, tests, build and package checks. Run it before you push. |
| `pnpm lint` | Check linting and formatting with Biome, without changing files. |
| `pnpm format` | Fix formatting and safe lint issues with Biome. |
| `pnpm typecheck` | Type-check all packages and the repository scripts. |
| `pnpm test` | Run all tests once. |
| `pnpm test packages/core/src/errors/fhirpath-error.test.ts` | Run one test file. |
| `pnpm test -t "formats a syntax error"` | Run the tests whose name matches. |
| `pnpm test:watch` | Run tests in watch mode. |
| `pnpm coverage` | Run tests with a coverage report in `coverage/`. |
| `pnpm build` | Build all packages with tsdown. |
| `pnpm check:packages` | Run publint, attw, the zero-dependency check and the size report. Needs a build first. |
| `pnpm changeset` | Add a changeset. |

The conformance runner gets its own command when [T0022](docs/tasks/T0022-conformance-runner.md) adds it.
