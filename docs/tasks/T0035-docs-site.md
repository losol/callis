# T0035 — Documentation site, progress page and deployment

Part of the [roadmap](../roadmap.md). Phase 3 · wave 2 · size L.

- **Depends on:** [T0022](T0022-conformance-runner.md)
- **Parallel with:** [T0002](T0002-parser.md), [T0006](T0006-quantity.md), [T0019](T0019-fhir-model-generator.md)
- **Background:** [ADR-0011](../adr/0011-conformance-suite.md), [architecture](../architecture.md#repository-layout)

## Goal

A documentation site for Callis at <https://callis.losol.no>, with the progress page as one section of it. The site is built from the documents in this repository, rebuilt on every merge to `main`, and deployed to Cloudflare ([design notes](#design-notes)).

It gives readers one place for the architecture, the decisions, the roadmap and tasks, the guides, the spec notes and the conformance reports, with search. The progress page shows how the project moves commit by commit: conformance, roadmap tasks, tests and source size.

## Scope

- `apps/site` (private, never published): a small [React Router](https://reactrouter.com/) app, prerendered to static HTML.
  - The content comes from `docs/**` (ADRs, tasks, roadmap, guides, spec notes, conformance reports), the root `README.md`, and the READMEs of `packages/*` and `tools/*`.
  - Full-text search in the header, a navigation tree built from the content, and a light and a dark theme (dark is the default).
  - Which files are published is a list in the site's config (`apps/site/docs.config.ts`), so a path can be left out with one line.
  - Links between documents resolve to site pages; a link to a file the site does not publish goes to GitHub.
- The progress page, a prerendered route (`/progress`) of the same app, linked from the header. A build step collects its data (`history.json`) from the git history. It shows, per commit on `main`: HL7 conformance (Phase 1 pass rate), roadmap tasks merged, unit test cases and source size. It also shows the roadmap as a board (merged, unblocked, blocked), the functions and operators each task adds, and a commit log, with a player to step through the history.
- `.github/workflows/deploy.yml`: build and deploy on a push to `main` and on manual dispatch.
- A build job in `.github/workflows/ci.yml` that builds the site on pull requests, so a broken site fails the PR and not the deploy.
- Root scripts `pnpm site:dev` and `pnpm site:build`, `apps/*` in `pnpm-workspace.yaml` and the `apps/site` project in the Vitest projects, the generated output in `.gitignore`, and a Biome override that allows the default exports React Router needs in `apps/site/app`.
- The docs for all of it: [architecture.md](../architecture.md#repository-layout) (the repository layout), [CONTRIBUTING.md](../../CONTRIBUTING.md#documentation-site) (the commands, the `site` environment and the secrets under *Repository settings*), and a README in `apps/site`.

Out of scope:

- Task frontmatter (a `status` and the list of functions a task provides). That is a plan change and gets its own `docs` PR. Until then the collector reads the task files as they are, and keeps that parsing in one module so the switch is local.
- A per-task and per-function conformance view. It needs real pass counts, which arrive with T0008 and T0023.
- API reference generated from `@callis/core`. That belongs to T0025.
- An interactive FHIRPath playground. It needs the engine and its public API (T0025), and is on the [backlog](../roadmap.md#backlog-not-scheduled). The site is built to leave room for it ([the playground](#room-for-a-playground)).
- Changing repository settings, secrets, DNS or the Cloudflare account. The owner does that ([owner actions](#owner-actions)).

## Design notes

### Build on lectio's packages, with our own app

[lectio-docs](https://github.com/losol/lectio-docs) (MIT, Losol AS) is a headless toolkit that gathers scattered documents into one content tree with a search index. Its reference site, `apps/site-builder`, renders that with React Router and ratio-ui and deploys to Cloudflare. The options were:

| Option | Verdict |
| --- | --- |
| The `lectio` CLI (`lectio build`) | No. It copies a fixed app into the repo and only takes a title and a GitHub link. It cannot add a route for the progress page, change the default theme, or choose what is published per section. It is also at 0.3.0. |
| An app of our own on `@eventuras/lectio-docs` and `@eventuras/lectio-docs-react` | **Chosen.** The parts that matter are reused as published packages: the collector (`collect`), the content source, the search index and the search component. We own only the routes, the layout and the config. |
| A site generator such as Starlight or Docusaurus | No. It would not give the monorepo collection that lectio does, and the progress page would have to live next to the site instead of in it. |

`apps/site` follows the shape of lectio's `apps/site-builder` (`root.tsx`, a docs route, the header, link resolution, a collect script). Where a file is adapted from it, a comment says so. The rendering uses `@eventuras/markdown` and `@eventuras/ratio-ui`. Both are MPL-2.0 and owned by Losol AS; they are dependencies of a private app, never of a published package.

### The site and the core stay apart

- Every dependency of `apps/site` is a dev-time dependency of that app only. `@callis/core` gets no new dependency, and does not import from, or depend on, the site. `scripts/check-runtime-deps.ts` still passes.
- `pnpm build` and `pnpm check:packages` keep working on `./packages/*`. The site has its own `build` script, and CI and the deploy workflow call it.
- `pnpm check` still covers the site where it is cheap: lint, typecheck and the unit tests of the collector. The full site build runs in CI.

### The progress page

The collector walks the first-parent history of the ref it is given (`HEAD` in CI). It reads git objects only (`git show`, `git grep`); it never checks out, builds or runs old commits. For each commit it records:

| Field | Source |
| --- | --- |
| PR number, date, subject | The squash commit's subject and date. |
| Tasks merged | `Task: T0001` lines in the commit body. The PR template makes this the first line of the description, and the description becomes the commit body ([CONTRIBUTING.md](../../CONTRIBUTING.md#pull-request-titles-and-commit-messages)). `Task: none` is ignored. A task counts from the first commit that names it. |
| Conformance | The summary table of `docs/conformance/r4.md` and `r5.md` at that commit, if they exist: per suite, the Total and the Phase 1 rows. Both reports are committed by `pnpm conformance` (T0022), so every commit since the runner was added has them; earlier commits have none, and the page shows no data for them. The adapter is named in the report's introduction (`evaluated with the **stub (no engine yet)** adapter`). The JSON summary of the runner is only a CI artifact and is not read. |
| Test cases | The number of `it(` and `test(` calls in `*.test.ts` files (`git grep -c`). `it.each` counts once, so this is a lower bound; the page says so. |
| Source lines | Lines in non-test `.ts` files under `packages/*/src`. |

The plan comes from `docs/roadmap.md` at the given ref: task IDs, titles, waves, sizes and dependencies. Use `parseRoadmap` from [`scripts/roadmap.ts`](../../scripts/roadmap.ts) instead of a second parser, so the roadmap format is read in one place. A task is *merged* at the first commit that names it, *unblocked* when all its dependencies are merged, and *blocked* otherwise.

Function and operator names come from the task files for T0010–T0017 and T0020: the backticked names in their *Goal* or *Scope* sections. The prose is not strictly regular, so the collector has a small table of which section and lines to read for each task, and tests pin the result. A function counts as available when its task is merged. That says the task landed, not that the function passes conformance tests; the page words it that way.

Rules for the page:

- Until the conformance runner has a real engine behind it, every test fails or is skipped, so the conformance line is flat at zero. The page shows that and says why, using the adapter name from the report. It never fakes progress.
- Everything that comes from git (commit subjects, task titles) is rendered as text by React, never as HTML.
- The charts have text labels and the log table holds the same numbers; everything works with the keyboard; animation stops under `prefers-reduced-motion`.
- The page uses the site's ratio-ui theme variables, so it follows the theme toggle.

The history is collected once per build, so the cost grows with the number of commits (a few `git` calls per commit). If it ever gets slow, cache the collected commits by SHA.

### Content and publication

The repository is public, and everything under `docs/**` is already readable on GitHub, so the site publishes all of it by default. The published set is a list of source globs and ignore globs in the site's config. If the owner decides some documents should not be on the site, they are added to the ignore list; the links to them then go to GitHub, or are dropped if the repository is private.

The site must not publish anything that is not in the repository: it reads files, not the issue tracker, review comments or the project board.

### Deployment

`deploy.yml` follows lectio's workflow:

- Actions pinned by commit SHA, with the version in a comment, the same pins as [`ci.yml`](../../.github/workflows/ci.yml). Node from `.node-version`.
- `actions/checkout` with `fetch-depth: 0`, because the progress page reads the whole history.
- Triggers: `push` to `main` and `workflow_dispatch`. `permissions: contents: read`. `concurrency` with `cancel-in-progress: false`, so a deploy is never cut off halfway.
- The job uses the `site` environment, with the URL <https://callis.losol.no>.
- It deploys as a Cloudflare Worker with static assets: `pnpm dlx wrangler@<pinned version> deploy --name callis --compatibility-date <date> --assets <build output>`. The Worker `callis` (`callis.losol.workers.dev`) exists, with the custom domain `callis.losol.no` attached in Cloudflare. The deploy adds no route, domain or DNS configuration, so it cannot fight what is attached. Wrangler is called directly, without `cloudflare/wrangler-action`, and its version is pinned. A Worker with static assets, and not Pages, means server-side logic later is a `main` entry and not a platform migration.
- It reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from secrets, and nothing else.
- It runs the same checks the pull request build ran (build and typecheck of the site) before it deploys, so it never publishes something that does not build.

### Owner actions

The PR changes no repository settings, secrets, DNS or Cloudflare configuration. The owner needs to:

- Make the Cloudflare credentials available to this repository: the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets, as organization secrets that include this repository or as repository secrets.
- Create the `site` environment, with `main` as the only deployment branch.
- Keep `callis.losol.no` attached to the Worker `callis` (done; the deploy leaves it alone).
- Turn off GitHub Pages for this repository (it is enabled with a workflow source, but no workflow publishes to it; the site lives on Cloudflare).
- Check that the secrets reach this repository and that the `site` environment exists. The site build does not need a required check of its own: add the job to the `needs` list of the `CI result` job in `ci.yml`, which is the one required check.

CONTRIBUTING.md lists these under *Repository settings*.

### Room for a playground

The owner wants an interactive FHIRPath playground on the site once the engine exists (T0025). It is not built here, but nothing in the site should stand in its way:

- Routes are plain React Router modules in `app/routes/`, listed in `app/routes.ts`. A `playground` route is one more entry, and it can be client-only: it imports `@callis/core` in the browser and evaluates there. The direction of the dependency is site → core; `@callis/core` never depends on the site.
- The site is a Worker with static assets, not a Pages project, so server-side logic later is a `main` entry in the Worker and not a platform migration.
- The theme, the header and the search are shared by every route, so a new route needs no layout work.

## Acceptance criteria

- [ ] `pnpm site:build` builds the site, and the build output holds a page for every published document, a search index and `/progress`. A shallow clone fails with a message that says the build needs the whole history.
- [ ] The site shows the architecture, the ADRs, the tasks, the roadmap, the guides, the spec notes, the conformance reports and the package READMEs, in a navigation tree, with working search and with links between documents that resolve.
- [ ] Dark is the default theme, the toggle works, and the choice is remembered.
- [ ] The progress page is correct for the current history: every ID in a `Task:` line is merged at its first commit, and the tasks that are not merged are split into unblocked and blocked from the roadmap's dependencies.
- [ ] Unit tests cover the `Task:` line parsing (including `Task: none` and a task named by two commits), the merged, unblocked and blocked rule, the reading of the conformance reports, the function-name extraction for each task that has a list (pinned against the task files of the repository), and the escaping of git data. A commit subject with `</script>` and HTML tags renders as text.
- [ ] The collector uses `parseRoadmap` and does not duplicate the roadmap format.
- [ ] The site works in both themes at a narrow and a wide viewport, can be used with the keyboard alone, and logs nothing to the browser console.
- [ ] `ci.yml` builds the site on pull requests, and only there. `deploy.yml` has the triggers, permissions, concurrency and environment above, pins every action by SHA and wrangler by version, and `pnpm dlx wrangler deploy` is the only step with the Cloudflare secrets.
- [ ] No runtime dependency is added to any published package, `@callis/core` does not depend on the site, and `pnpm check` passes.
- [ ] CONTRIBUTING.md and `architecture.md` document the site, the commands, the `site` environment, the secrets and the owner actions above.

## Follow-ups

- Task frontmatter (`status`, the functions a task provides, its conformance groups), so the page can stop parsing prose. A separate `docs` PR, after this task.
- A per-task and per-function conformance view, once T0008 and T0023 give real numbers.
- Generated API reference, with T0025.
