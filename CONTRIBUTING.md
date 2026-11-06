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
| [`RELEASING.md`](RELEASING.md) | How the owner releases the packages. |
| `docs/spec-notes.md` | Interpretations of the FHIRPath specification (created when first needed). |
| GitHub issues and the [Callis roadmap](https://github.com/orgs/losol/projects/11) project | Task status, follow-ups and bugs ([task issues](#task-issues-and-the-project-board)). |

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

**Scopes** name the package, app or tool directory the change is about: `core`, `ucum`, `fhir-r4`, `fhir-r5`, `cli`, `conformance`, `model-gen`, `site`. The scope is optional for repository-wide `docs`, `build`, `ci` and `chore` changes. Use one scope. If a PR needs two, it is usually two PRs.

**Summary**

- Use the imperative mood: "add", not "added" or "adds".
- Start with a lowercase word, and end without a period.
- Keep the whole title at most 72 characters.
- Say what changes for someone reading `git log --oneline`. Task IDs and issue numbers go in the description, not the title.

**Breaking changes** add `!` after the type or scope. This applies before 1.0 too. The description and the changeset must also explain the change ([API changes](#api-changes)).

| Good | Not good |
| --- | --- |
| `feat(core): add lexer` | `T0001 lexer` |
| `fix(core): return empty for division by zero` | `fix: fixed bug` |
| `feat(core)!: rename evaluate option output to format` | `feat(core): Breaking change in options.` |
| `docs: record UTC as default timezone` | `docs: update docs` |
| `build: pin tsdown 0.23` | `chore(deps): Bump stuff` |

**Commits on your branch** are not kept individually on `main`. Write them so a reviewer can follow the work; the same format is encouraged but not required. Do not rewrite branch history once review has started, so review comments stay attached to their lines.

**Trailers.** Credit co-authors who are people with a `Co-authored-by: Name <email>` [Git trailer](https://git-scm.com/docs/git-interpret-trailers) at the end of a commit message or PR description. GitHub shows them as co-authors. Do not add trailers or other attribution for AI tools.

## Pull requests

- **One task per PR.** Stay within the task's scope. Open a follow-up issue for anything else and list it in the description ([Findings during a task](#findings-during-a-task)).
- **Keep PRs reviewable.** If hand-written changes grow far beyond a few hundred lines, split along the task's natural seams (for example `T0008a` and `T0008b`) and update the task file. Generated files do not count.
- **Fill in the template.** The description becomes the commit body on `main`, so keep it accurate and delete the template comments. It must start with `Task: T0001` (or `Task: none`) so `git log --grep "Task: T0001"` finds the commit.
- **Reviews:** Copilot reviews every PR automatically. An AO review can be requested for implementation PRs. The owner's approval is required to merge.
- **Stay up to date** with `main` by merging it into your branch; avoid force-pushing after review has started.

## Findings during a task

While working on a task you will find things that are not part of it: a bug in merged code, a gap in a later task, a task file that is wrong. Record each finding where the next person will see it. A note that only lives in a PR description is lost once the PR is merged.

| What you find | What to do |
| --- | --- |
| Something your task needs | Do it in your PR. |
| Your task file is wrong or unclear | Fix the task file in your PR and say why in the description. |
| Your task is too big | Split it (`T0008a`, `T0008b`) and update the task file and the roadmap in your PR. |
| An ambiguity in the spec | Record your interpretation in `docs/spec-notes.md` in your PR. |
| Something that blocks your task | Say so in the PR and ask the owner. Do not work around it. |
| A bug, gap or improvement outside your task | Open a follow-up issue. Do not fix it in your PR. |
| A problem with another task file, the roadmap or the dependencies | Open a follow-up issue. Do not edit them in your PR. |
| A question that needs an architecture decision | Open a follow-up issue for the owner. Do not change the ADR. |

### Follow-up issues

- Search the open issues first. If the finding is already there, add a comment instead.
- One finding per issue, opened when you find it rather than after the merge.
- Use the **Follow-up** issue form. From the command line, use `gh issue create --label follow-up` with the form's headings: `### Found in` (task ID and PR), `### Kind`, `### What you found` (concrete input, file, spec anchor or test name), `### Why it matters` and `### Suggested home` (an existing task, a new task or the backlog).
- List the issues under *Follow-ups* in your PR description.

### Changing the plan

The task files and the [roadmap](docs/roadmap.md) are the plan. Issues are the inbox: a follow-up issue does not change the plan by itself.

- The owner triages follow-up issues. An accepted one becomes one of these:
  - a change to an existing task file (scope, design notes or acceptance criteria)
  - a new task: a task file with the next free ID and a roadmap row with dependencies, wave and size (the [roadmap sync](#roadmap-sync) creates its task issue)
  - a line in the roadmap backlog
- Plan changes are `docs` PRs with `Task: none`, made by the owner or by an agent the owner asked to do it. The PR closes the follow-up issue. A declined issue is closed with the reason. Run `pnpm check:roadmap` before you push.
- Inside a task PR, only two plan changes are allowed: correcting that task's own file and splitting that task.
- Task IDs are never reused or renumbered.

### Task issues and the project board

Every task has a task issue titled like `T0001: Lexer`, labelled `task` and with its wave (`wave-1`, …), and an item on the [Callis roadmap](https://github.com/orgs/losol/projects/11) project board. The issue links the task file. The PR that implements the task closes the issue with `Closes #<issue>`.

| What | Source of truth | Copied to |
| --- | --- | --- |
| Scope, design notes, acceptance criteria | The task file | Nowhere; the issue links the file. |
| Title, phase, wave, size, dependencies | The overview table in the [roadmap](docs/roadmap.md) | The task file header, the dependency graph and the waves table (checked); the issue title and labels, its "blocked by" links and the project fields (synced). |
| Status, assignee, linked PR | The task issue and the project board | Nowhere. |
| Findings during a task | Follow-up issues | The plan, once the owner accepts them. |

Do not change the synced data on GitHub by hand; change the roadmap instead. The next sync overwrites it.

### Roadmap sync

- `pnpm check:roadmap` checks that the overview table, the dependency graph, the waves table and the header of every task file agree. It is part of `pnpm check` and CI.
- `pnpm sync:roadmap` shows what would change on GitHub, and `pnpm sync:roadmap --apply` makes the changes. The sync creates missing task issues, sets their titles and labels, links each issue as "blocked by" the issues of its dependencies, and adds the issues to the project board with the fields Task, Phase, Wave, Size and Depends on. It fills in Status only when it is empty.
- The sync never rewrites issue bodies, closes or reopens issues, or touches issues without the `task` label. A task removed from the roadmap keeps its issue; close it by hand.
- After a plan change is merged, the **Roadmap sync** workflow runs the sync on `main`. It needs the `ROADMAP_SYNC_TOKEN` secret (see [Repository settings](#repository-settings)). Without the secret the workflow does nothing, and a maintainer runs the sync by hand.
- To add a task: write the task file, then add its row to the overview, its edges to the graph and its ID to the waves table, and run `pnpm check:roadmap`. The sync creates the task issue after the merge.

## Definition of done

A PR is ready to merge when:

- the acceptance criteria in its task file are met
- `pnpm check` is green
- new behaviour has tests that cite the spec section they cover ([testing guide](docs/guides/testing.md))
- user-visible changes to a publishable package have a changeset
- the task file, `docs/spec-notes.md` and ADRs are updated where the change affects them
- the conformance baseline did not go down

## API changes

Users depend on the public API, and other packages implement its interfaces (`ModelProvider`), so design it to last. Until 1.0 a breaking change is allowed, but only as a last resort.

- **Design forward.** Before you add public API, read the task files that will build on it. Prefer optional members, options objects and extensible unions over positional parameters and closed shapes, so later tasks can extend it without breaking it.
- **Look for a compatible change first,** such as a new optional member or option, or a new function next to the old one.
- **Justify a breaking change.** Add `!` to the PR title. Under an *Interface changes* heading in the description, state what breaks, why, which alternatives you considered, and how to migrate. The changeset says what breaks and how to migrate.
- **Before 1.0,** any public API, including `ModelProvider`, may break in a minor release under these rules. What is frozen for 1.0 is decided separately ([roadmap backlog](docs/roadmap.md#backlog-not-scheduled)).

## Changesets

Versions and changelogs are managed with [Changesets](https://github.com/changesets/changesets), not with commit messages.

- Add a changeset (`pnpm changeset`) for every user-visible change to a published package: behaviour, API, types or packaging. Tests, docs and internal tooling do not need one.
- Choose the bump with [SemVer](https://semver.org) in mind. Before 1.0, use `minor` for new features and breaking changes, and `patch` for fixes. Never use `major` before 1.0: it would release 1.0.0.
- Write the summary for users of the package: what changed, and how to migrate if they must.

## Releases

Only the owner releases, following the runbook in [RELEASING.md](RELEASING.md). Agents never publish.

- **A placeholder reserves each package name.** npm only configures a trusted publisher for a package that exists. So before a package's first release, the owner publishes a placeholder `0.0.1` by hand, with no code, and deprecates it at once.
- **Every release, from 0.1.0 on,** goes through the [Release workflow](.github/workflows/release.yml) with [changesets/action](https://github.com/changesets/action), with provenance. Nothing is published until the owner merges the version PR, and it is not merged before 0.1.0 is ready.
- **The version PR.** While changesets are pending, every push to `main` opens or updates a PR titled `chore: version packages`. It bumps the versions, writes the changelogs and deletes the changesets. It is a draft, and every update turns it back into one, so releasing starts with a deliberate *Ready for review*. Its body lists each package with the version it will publish. Only the owner merges it.
- **Prereleases.** While `.changeset/pre.json` is in `pre` mode, the version PR is `chore: version packages (next)`. It releases prereleases such as `0.1.0-next.0` under the npm dist-tag `next`, and `latest` does not move ([RELEASING.md](RELEASING.md#5-prereleases)).
- **CI on the version PR.** The workflow pushes with the `GITHUB_TOKEN`, and events from that token start no workflows, so the version PR gets no checks by itself. Close and reopen it before you merge: that runs CI and the PR-title check, which the branch rules require.
- **Publishing.** Merging the version PR leaves no changesets pending. The next run builds the packages, runs the package checks (`pnpm release`) and publishes every package whose version is not on npm yet. It tags each one, for example `@callis/core@0.1.0`, and creates a GitHub release.
- **npm trusted publishing.** The workflow signs in to npm with OIDC, so no npm token exists anywhere, and npm adds [provenance](https://docs.npmjs.com/generating-provenance-statements) to each version. The job runs in the `npm` environment, which only allows `main`. On npm, each package has a [trusted publisher](https://docs.npmjs.com/trusted-publishers/) for this repository, `release.yml` and the `npm` environment, and the trusted publisher allows direct `npm publish`. New trusted publishers only allow `npm stage publish` by default, and Changesets publishes directly. A new trusted publisher expires if it has not published within two days, so it is created right before the package's first release from the workflow.

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
- The documentation site in `apps/site` is a private app that is never published. Its dependencies are dev-time dependencies of that app only, and `@callis/core` neither depends on them nor on the site. It uses MPL-2.0 packages from Losol AS (`@eventuras/ratio-ui`, `@eventuras/markdown`) and the MIT-licensed `@eventuras/lectio-docs` packages.
- Vendored data (test fixtures, UCUM tables, FHIR definitions) records its source, version and license next to it.
- Never commit secrets or real patient data. Fixtures are synthetic or official HL7 examples.

## Repository settings

For maintainers. These settings make the rules above hold:

- **Merging:** squash merge only. The squash commit takes the PR title as its subject and the PR description as its body. Branches are deleted automatically after merge.
- **Required checks:** `CI result` and `Conventional Commits`. `CI result` is the last job in the CI workflow and fails when any other CI job fails, so CI jobs can change without changing this setting. `Conventional Commits` is the PR-title check.
- **Approval:** the owner's approval is required.
- **Secrets:** `ROADMAP_SYNC_TOKEN` for the [roadmap sync](#roadmap-sync). A fine-grained token owned by `losol` with read and write access to issues in this repository and to the organization's projects, or a classic token with the `repo` and `project` scopes.
- **Environments:** `npm`, for the release workflow, with `main` as its only deployment branch.
- **Documentation site:** the [deploy workflow](#documentation-site) needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, as organization secrets that include this repository or as repository secrets, and a `site` environment whose only deployment branch is `main`. The Worker is named `callis`, and the custom domain `callis.losol.no` is attached to it in Cloudflare; the deploy adds no route, domain or DNS configuration. GitHub Pages stays off: the site is served from Cloudflare.

## Documentation site

The site at <https://callis.losol.no> is built from this repository by `apps/site` (see its [README](apps/site/README.md)): the documents under `docs/`, the root `README.md` and this file, the READMEs of `packages/*` and `tools/*`, and a progress page that shows the project commit by commit. It is [T0035](docs/tasks/T0035-docs-site.md).

- **Writing for it:** write documents as usual. Link to other documents by path (`../adr/0001-spec-baseline.md`); the site turns the link into a link to the page, or to GitHub when the document is not published. A document's title is its first heading.
- **What is published:** the list is in [`apps/site/docs.config.ts`](apps/site/docs.config.ts). The repository is public, so everything under `docs/` is published. To leave a document out, add its path to `ignore`.
- **Node:** the site needs the development Node (`.node-version`, 24); a dependency of it does not support Node 26 yet, so `pnpm install` fails there. On Node 26 install without the site: `pnpm install --filter "!@callis/site"`.
- **CI** builds the site on every pull request, so a change that breaks it fails the PR. The **Deploy** workflow builds it again and publishes it as a Cloudflare Worker with static assets on every push to `main`; it can also be run by hand.
- **The progress page** reads the git history. It counts a task as merged at the first commit whose message has a `Task: T0001` line, which is why the PR description must start with it.

## Commands

You need Node.js 22.18+, 24.11+ or 26+ (the `engines` range in `package.json`, set by what the build tools support; `.node-version` pins 24 for development) and [pnpm](https://pnpm.io/installation). The published packages have their own, wider runtime range. Any recent pnpm switches to the version pinned in `package.json` (`packageManager`) by itself.

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
| `pnpm site:dev` | Collect the documents and run the [documentation site](#documentation-site) locally. |
| `pnpm site:build` | Build the documentation site into `apps/site/build/client/`. Needs the whole git history for the progress page. |
| `pnpm check:packages` | Run publint, attw, the zero-dependency check and the size report. Needs a build first. |
| `pnpm check:title "feat(core): add lexer"` | Check a PR title against the rules above, as CI does. |
| `pnpm check:roadmap` | Check that the roadmap and the task files agree. |
| `pnpm sync:roadmap` | Show what the [roadmap sync](#roadmap-sync) would change on GitHub. Add `--apply` to make the changes. |
| `pnpm changeset` | Add a changeset. |
| `pnpm changeset:version` | Apply the pending changesets: bump versions and write changelogs. The release workflow runs it for the version PR. |
| `pnpm release` | Build, run the package checks and publish with Changesets. Only the release workflow runs it. |
| `pnpm conformance` | Run the HL7 FHIRPath test suite, write the reports in `docs/conformance/` and compare with the baseline. |
| `pnpm conformance --update-baseline` | The same, and record newly passing tests in the baseline. |
| `pnpm test:conformance -t testLiterals` | Run suite tests as Vitest tests, with a diff for each wrong result. |

CI also runs `pnpm conformance --check`; when it fails, so does the required `CI result` check. It fails when a baseline test stops passing or the baseline is out of date, and only warns when the reports in `docs/conformance/` are out of date. The conformance runner is described in [tools/conformance](tools/conformance/README.md).
