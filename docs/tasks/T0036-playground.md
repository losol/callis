# T0036 — Simple FHIRPath playground

Part of the [roadmap](../roadmap.md). Phase 3 · wave 6 · size M.

- **Depends on:** [T0025](T0025-public-api-release.md), [T0035](T0035-docs-site.md)
- **Background:** [T0037](T0037-first-release-readiness.md) (first-release support and limitations)

## Goal

Let users try the implemented Callis subset in the browser: edit synthetic JSON and a FHIRPath expression, run it, and inspect the result or an error. This is a small addition to the completed documentation site, not a replacement for T0035.

## Scope

- A linked playground route in `apps/site`, using the public `@callis/core` API locally in the browser. Site → core only; core never depends on the site or an editor. The playground can use workspace packages before npm publication.
- Editable JSON input and expression, an explicit run action, formatted result collection and an accessible error display. Distinguish JSON input errors from FHIRPath errors; show stable code/message and source position when available. A failed run clears or labels the previous result so it cannot look current.
- Several synthetic examples covering implemented navigation, empty results, literals and operators. Examples must run against the public entry point in CI. Do not advertise pending functions or model-aware semantics.
- Exact Decimal/Quantity display through `decimalOutput: 'string'`; document precision already lost by `JSON.parse`. Do not serialize private typed values or import core internals.
- Keyboard operation, labels, narrow/wide layouts, both themes and visible limitations/conformance links. Handle malformed JSON, invalid expressions and unsupported functions without crashing the page.
- Browser interaction tests for editing both inputs, running examples, displaying results and recovering from errors. Check the existing CSP and browser build; do not add a runtime dependency to any published package.

## Design notes

### Selected approach and evidence

The owner accepted the replacement research on 2026-11-06. Keep the existing React Router site with Lectio Docs and Ratio. Use exactly `@eventuras/ratio-ui-codeeditor@0.1.1` for JSON, with `tabIndents={false}` and a stable accessible name; use a native labelled expression field, an explicit Run button and Cmd/Ctrl-Enter. Add `/playground` before the wildcard documentation route, prerender its shell, add navigation and correct the Docs active rule. No site rewrite is needed.

The research inspected these sources and the actual editor npm tarball without running them:

- [Callis site and completed T0035](https://github.com/losol/callis/tree/06012c663a4636b9bb963f70d16c6d25ca11ee37/apps/site), including routing, prerendering and the shared header.
- [Ratio editor source, stories and license](https://github.com/losol/ratio-ui/tree/eb696255f51f2b2489c956d8105de18d708c71fc/packages/ratio-ui-codeeditor) and [published 0.1.1 metadata](https://registry.npmjs.org/@eventuras%2fratio-ui-codeeditor/0.1.1): controlled edits, JSON language loading, run shortcut, line diagnostics, React 19 peers and MPL-2.0 license. The experimental API needs an exact pin. Existing Ratio 2.35.1 CSS already contains the editor tokens; no broad upgrade is needed.
- [Lectio React integration](https://github.com/losol/lectio-docs/tree/49cb308cd4f9582cf0c067db6c246f5ebb2ac126/packages/lectio-docs-react/src), including Search and its global Cmd/Ctrl-K shortcut. Retain the existing content/search integration.

The editor provides no FHIRPath language and JSON highlighting does not validate JSON. Parse input in Callis's playground, render escaped results in `pre`/`code`, and show visible accessible error/status panels. Line diagnostics have no source columns: expression errors belong by the expression field, not in the JSON editor. Clear stale results and diagnostics after errors or preset changes. Initial presets can use `Patient.name.given`, `name[0].given`, a missing field, Boolean logic and T0010 arithmetic; do not use pending `where`, `exists` or `resolve` functions.

Mount or lazy-load the editor in the browser with a labelled prerendered fallback. Inspect direct navigation/hydration, editor teardown, Shift-Tab/Tab exit, preset focus, Cmd/Ctrl-Enter and the existing docs-search shortcut. Keep editor/core out of documentation-route startup and measure the built route chunks; the 72,138-byte npm unpacked size excludes CodeMirror/Lezer and is not a browser bundle measurement. Verify parser chunk loading and dependency deduplication.

Preserve upstream copyright/license notices and provide editor source/version/license links in site notices. Lectio is MIT; Ratio/editor is MPL-2.0. Keep the core license unchanged. FHIRPath-specific integration remains in Callis; generic accessibility, diagnostic range, packaging-doc and search-shortcut suggestions belong upstream, separately, and do not block this route without a demonstrated defect. No automatic data transmission, URL sharing or remote persistence is needed.

Source inspection is evidence for the choice, not proof of runtime behaviour. The implementation must verify the browser, hydration, accessibility, themes and bundle criteria below.

### Dependency direction

T0025 → playground → first-release readiness. Neither the public API nor the playground requires the npm release to exist. T0038 completion proceeds independently of first-release preparation, so there is no API/playground/release cycle.

## Acceptance criteria

- [ ] A user can edit JSON and expression, run, inspect a result, trigger both JSON and FHIRPath errors, correct them and rerun.
- [ ] Examples use synthetic data and implemented capabilities, and pass automated public-API checks.
- [ ] Exact Decimal output, empty collections and stable FHIRPath errors render intelligibly; no stale result is mistaken for a successful current run.
- [ ] The selected pinned JSON editor works with the labelled expression field, prerendered shell and direct-route hydration; FHIRPath-specific code remains in Callis. Editor licensing/source notices are present and generic upstream improvements remain separate.
- [ ] Keyboard traversal, run/preset focus, search shortcuts, themes, responsive layout and browser interaction checks pass; no console errors. Route chunk sizes/loading and dependency deduplication are checked; `pnpm check` and the site build pass.
- [ ] Support/limitations and conformance links match the engine revision used by the playground. No package publication or repository/deployment setting changes.

## Optional upstream follow-ups

These generic proposals are separate from Callis and are not release blockers without a demonstrated implementation defect:

- [Ratio #319](https://github.com/losol/ratio-ui/issues/319): accessible field attributes on the editor's editing surface.
- [Ratio #320](https://github.com/losol/ratio-ui/issues/320): optional precise diagnostic ranges, retaining line diagnostics.
- [Ratio #321](https://github.com/losol/ratio-ui/issues/321): clarify npm tags and parser packaging in editor documentation.
- [Lectio #62](https://github.com/losol/lectio-docs/issues/62): configurable command-palette shortcut in React Search.
