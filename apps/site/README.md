# @callis/site

The documentation site and progress page of Callis, at <https://callis.losol.no>. A private app; it is never published ([T0035](../../docs/tasks/T0035-docs-site.md)).

It is a [React Router](https://reactrouter.com/) app, prerendered to static HTML. The documents are collected with the [`@eventuras/lectio-docs`](https://github.com/losol/lectio-docs) toolkit (MIT, Losol AS) and rendered with ratio-ui. The app follows the shape of lectio's reference site, `apps/site-builder`; the files adapted from it say so.

## Commands

Run them from the repository root.

| Command | What it does |
| --- | --- |
| `pnpm site:dev` | Collect the documents and run the site with a dev server. |
| `pnpm site:build` | Collect and build the static site into `apps/site/build/client/`. |
| `pnpm --filter @callis/site typecheck` | Type-check the site. `pnpm typecheck` does it too. |

The build needs the whole git history (the progress page reads it), so a shallow clone fails with a message that says so.

## How it works

1. `scripts/collect.ts` collects the sources in [`docs.config.ts`](docs.config.ts) into `.lectio/` (the documents and a `manifest.json`), writes the search index to `public/search-index.json`, and writes the progress data to `.lectio/progress.json`. All three are generated and git-ignored.
2. React Router prerenders a page for every manifest entry, and `/progress`. The loaders read the collected files in Node at build time, so the output is plain HTML and a Worker only serves assets.
3. The search index is loaded by the browser on the first query.

## Layout

| Path | What |
| --- | --- |
| `docs.config.ts` | What the site publishes, and in which order. |
| `scripts/collect.ts` | The collect step. |
| `progress/` | Reads the git history and the roadmap into the progress data. Plain TypeScript with unit tests; `state.ts` is shared with the page. |
| `app/root.tsx`, `app/components/site-header.tsx` | The layout, the theme (dark by default) and the header. |
| `app/routes/docs.tsx` | The document pages: navigation, rendering, link resolution. |
| `app/routes/progress.tsx`, `app/components/progress/` | The progress page. |
| `app/routes.ts` | The route table. A later `playground` route (T0035, "Room for a playground") is one more entry that imports `@callis/core` in the browser. |

## The progress page

For every commit on the main line of the history it shows the HL7 conformance of Phase 1, the roadmap tasks merged, the unit test cases and the source size, the roadmap as a board (merged, unblocked, blocked), the functions and operators each task adds, and a commit log. A player steps through the history (arrow keys, space bar, slider).

- **Conformance** is read from the summary table of `docs/conformance/r4.md` and `r5.md` at each commit. Until the conformance runner has a real engine, every test fails or is skipped, so the line is flat at zero, and the page says why.
- **Tasks** are merged at the first commit with a `Task: T0001` line in its message. A task is unblocked when all its dependencies are merged. The plan is read with `parseRoadmap` from [`scripts/roadmap.ts`](../../scripts/roadmap.ts).
- **Functions and operators** are read from the backticked names in the task files of T0010–T0017 and T0020 (`progress/items.ts`); a unit test pins the lists. A function counts as available when its task is merged, which says the task landed, not that the function passes conformance tests.
- **Test cases** are the calls of `it(` and `test(` in `*.test.ts`, so `it.each` counts once: a lower bound.

## Deployment

`.github/workflows/deploy.yml` deploys on every push to `main`; see [CONTRIBUTING.md](../../CONTRIBUTING.md#documentation-site).

## The playground

`/playground` is a prerendered shell. After hydration it loads the JSON editor
and the public `@callis/core` evaluator in the browser. It does not import an
internal engine entry point, send input to a server, or persist input in storage
or URLs. Editing either field clears the previous result; presets and reset
replace both fields. JSON parsing errors are separate from FHIRPath errors.

Computed Decimals and Quantity values use `decimalOutput: 'string'` for exact
output. Input uses `JSON.parse`, so numeric precision already lost while parsing
JSON cannot be recovered. Presets are synthetic and tested against the public
API; the page describes the supported subset rather than promising all FHIRPath.

The JSON editor is pinned to `@eventuras/ratio-ui-codeeditor` 0.1.1 (MPL-2.0,
Losol AS), using the site's Ratio CSS tokens. Its upstream source and license
are linked on the page. CodeMirror uses MIT. Keep their license notices in
bundled output; any changes to covered upstream files must retain their source
and notices. Domain behavior and error handling stay in this app and core.

After `pnpm site:build`, run `pnpm --filter @callis/site test:browser` for the
Chromium interaction checks. Install the browser once with
`pnpm --filter @callis/site exec playwright install chromium`. CI does this in
the site job. The test server serves each route's prerendered HTML, including
the `/playground/` directory route, rather than an SPA root fallback.

The site's dev, build, typecheck and unit-test commands first build core so
fresh checkouts use its real public package entry point. The editor and evaluator
are imported only after the playground mounts; a browser regression check guards
the documentation route against loading that client chunk.
