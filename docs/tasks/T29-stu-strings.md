# T29 — STU: string and regex additions

Part of the [roadmap](../roadmap.md). Phase 2 · wave 8 · size M.

- **Depends on:** [T25](T25-public-api-release.md)

## Goal

`lastIndexOf`, `matchesFull`, regex `flags` on `matches` and `replaceMatches`, `encode`/`decode` (`base64`, `urlbase64`, `hex`), `escape`/`unescape` (`html`, `json`), `trim`, `split` and `join`, all without runtime dependencies.

## Acceptance criteria

Conformance groups `testEncodeDecode`, `testEscapeUnescape`, `testTrim`, `testSplit` and `testJoin` pass, as do the STU cases in `testMatches`.
