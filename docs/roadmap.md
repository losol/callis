# Callis roadmap

> Status: **accepted** (owner review, 2026-11-03). This is the index of the tasks that build Callis. Each task has its own file in [`tasks/`](tasks/) with goal, scope, design notes and acceptance criteria. The big picture is in [architecture.md](architecture.md); the reasons behind decisions are in [`adr/`](adr/README.md).
> Task IDs are four-digit and stable (`T0000`, `T0001`, …), like the ADR numbers. The file name starts with the ID (`T0000-scaffold.md`). Refer to the IDs in branch names, PR titles and commit messages; the fixed width keeps searches unambiguous (`T0001` never matches `T0010`).

## How to use this roadmap

- **One task = one PR.** A worker reads its task file and the ADRs it links. If a task turns out too big, split it in the PR that starts it (for example `T0008a`/`T0008b`) and update the task file and this index.
- **Workflow, PR titles and the definition of done** are in [CONTRIBUTING.md](../CONTRIBUTING.md); agents also follow [AGENTS.md](../AGENTS.md).
- **Conformance groups** listed for a task are the groups from the HL7 test suite (`tests-fhir-r5.xml`) that the task should turn green. Until the conformance runner and converted fixtures exist (T0022, T0023), they are informational. After that, the PR shows the conformance delta, and the baseline may only go up.
- **Sizes** are rough, for one worker: **S** ≈ 1 day, **M** ≈ 2–4 days, **L** ≈ 1–2 weeks.

## Overview

| ID | Task | Phase | Depends on | Wave | Size |
| --- | --- | --- | --- | :---: | :---: |
| [T0000](tasks/T0000-scaffold.md) | Repository scaffold | 0 | – | 0 | M |
| [T0001](tasks/T0001-lexer.md) | Lexer | 1 | T0000 | 1 | M |
| [T0002](tasks/T0002-parser.md) | Parser and AST | 1 | T0001 | 2 | M |
| [T0003](tasks/T0003-types-and-collections.md) | Type system and collection foundations | 1 | T0000 | 1 | M |
| [T0004](tasks/T0004-decimal.md) | Decimal | 1 | T0000 | 1 | M |
| [T0005](tasks/T0005-date-time.md) | Date, DateTime and Time values | 1 | T0000 | 1 | L |
| [T0006](tasks/T0006-quantity.md) | Quantity and minimal unit system | 1 | T0004 | 2 | M |
| [T0007](tasks/T0007-ucum.md) | `@callis/ucum` package | 1 | T0006 | 3 | L |
| [T0008](tasks/T0008-compiler-evaluator.md) | Compiler and evaluator core | 1 | T0002, T0003, T0004, T0005, T0006 | 3 | L |
| [T0009](tasks/T0009-equality-kernels.md) | Equality, equivalence and ordering kernels | 1 | T0003, T0004, T0005, T0006 | 3 | M |
| [T0010](tasks/T0010-operators.md) | Operators | 1 | T0008, T0009 | 4 | L |
| [T0011](tasks/T0011-fn-existence.md) | Functions: existence | 1 | T0008, T0009 | 4 | S |
| [T0012](tasks/T0012-fn-filtering.md) | Functions: filtering and projection | 1 | T0008, T0009 | 4 | M |
| [T0013](tasks/T0013-fn-subsetting-combining.md) | Functions: subsetting and combining | 1 | T0008, T0009 | 4 | S |
| [T0014](tasks/T0014-fn-conversion.md) | Functions: conversion | 1 | T0008 | 4 | M |
| [T0015](tasks/T0015-fn-string.md) | Functions: string manipulation | 1 | T0008 | 4 | M |
| [T0016](tasks/T0016-fn-math.md) | Functions: math | 1 | T0008 | 4 | S |
| [T0017](tasks/T0017-fn-tree-utility.md) | Functions: tree navigation and utility | 1 | T0008 | 4 | S |
| [T0018](tasks/T0018-model-aware-evaluation.md) | Model-aware evaluation | 1 | T0008 | 4 | L |
| [T0019](tasks/T0019-fhir-model-generator.md) | FHIR model generator and model packages | 1 | T0003 | 2 | L |
| [T0020](tasks/T0020-fhir-functions.md) | FHIR functions and variables | 1 | T0009, T0018 | 5 | M |
| [T0021](tasks/T0021-hooks-async.md) | Host hooks and async evaluation | 1 | T0020 | 6 | M |
| [T0022](tasks/T0022-conformance-runner.md) | Conformance runner | 1 | T0000 | 1 | M |
| [T0023](tasks/T0023-xml-fixture-conversion.md) | FHIR XML fixture conversion | 1 | T0019, T0022 | 3 | M |
| [T0024](tasks/T0024-static-analysis.md) | Static analysis and strict mode | 1 | T0018, T0019 | 5 | L |
| [T0025](tasks/T0025-public-api-release.md) | Public API, documentation and release 0.1.0 | 1 | phase 1 | 7 | M |
| [T0026](tasks/T0026-stu-aggregates.md) | STU: aggregates and variables | 2 | T0025 | 8 | M |
| [T0027](tasks/T0027-stu-collections.md) | STU: collection additions | 2 | T0025 | 8 | M |
| [T0028](tasks/T0028-stu-long.md) | STU: `Long` type | 2 | T0025 | 8 | M |
| [T0029](tasks/T0029-stu-strings.md) | STU: string and regex additions | 2 | T0025 | 8 | M |
| [T0030](tasks/T0030-stu-precision-datetime.md) | STU: precision, boundaries and date/time additions | 2 | T0025 | 8 | L |
| [T0031](tasks/T0031-stu-reflection.md) | STU: reflection and instance selector | 2 | T0025 | 8 | M |
| [T0032](tasks/T0032-fhir-phase2.md) | FHIR phase 2: structure functions and R5 service APIs | 2 | T0025 | 8 | L |
| [T0033](tasks/T0033-performance.md) | Benchmarks and performance | 3 | T0025 | 8 | L |
| [T0034](tasks/T0034-cli.md) | CLI (optional) | 3 | T0025 | 8 | M |

## Dependency graph

```mermaid
flowchart TD
  subgraph P0["Phase 0: foundation"]
    T0000["T0000 Scaffold"]
  end

  subgraph P1["Phase 1: N1 normative + FHIR"]
    T0001["T0001 Lexer"]
    T0002["T0002 Parser + AST"]
    T0003["T0003 Types + collections"]
    T0004["T0004 Decimal"]
    T0005["T0005 Date/time"]
    T0006["T0006 Quantity"]
    T0007["T0007 @callis/ucum"]
    T0008["T0008 Compiler + evaluator"]
    T0009["T0009 Equality kernels"]
    T0010["T0010 Operators"]
    T0011["T0011 fn: existence"]
    T0012["T0012 fn: filtering"]
    T0013["T0013 fn: subsetting + combining"]
    T0014["T0014 fn: conversion"]
    T0015["T0015 fn: string"]
    T0016["T0016 fn: math"]
    T0017["T0017 fn: tree + utility"]
    T0018["T0018 Model-aware evaluation"]
    T0019["T0019 FHIR model generator"]
    T0020["T0020 FHIR functions + variables"]
    T0021["T0021 Hooks + async"]
    T0022["T0022 Conformance runner"]
    T0023["T0023 XML fixture conversion"]
    T0024["T0024 Static analysis"]
    T0025["T0025 Public API + docs + 0.1.0"]
  end

  subgraph P2["Phase 2: STU"]
    T0026["T0026 Aggregates + variables"]
    T0027["T0027 Collection additions"]
    T0028["T0028 Long"]
    T0029["T0029 String + regex additions"]
    T0030["T0030 Precision + date/time additions"]
    T0031["T0031 Reflection + instance selector"]
    T0032["T0032 FHIR phase 2"]
  end

  subgraph P3["Phase 3: performance + tooling"]
    T0033["T0033 Benchmarks + performance"]
    T0034["T0034 CLI"]
  end

  T0000 --> T0001 & T0003 & T0004 & T0005 & T0022
  T0001 --> T0002
  T0004 --> T0006
  T0006 --> T0007
  T0003 --> T0019
  T0002 & T0003 & T0004 & T0005 & T0006 --> T0008
  T0003 & T0004 & T0005 & T0006 --> T0009
  T0008 & T0009 --> T0010 & T0011 & T0012 & T0013
  T0008 --> T0014 & T0015 & T0016 & T0017 & T0018
  T0009 & T0018 --> T0020
  T0020 --> T0021
  T0019 & T0022 --> T0023
  T0018 & T0019 --> T0024
  T0007 & T0010 & T0011 & T0012 & T0013 & T0014 & T0015 & T0016 & T0017 & T0021 & T0023 & T0024 --> T0025
  T0025 --> T0026 & T0027 & T0028 & T0029 & T0030 & T0031 & T0032 & T0033 & T0034
```

## Waves (suggested order)

Tasks in the same wave can be worked on in parallel. A task can start as soon as its own dependencies are merged; it does not have to wait for its whole wave.

| Wave | Tasks | Parallel workers | Notes |
| :---: | --- | :---: | --- |
| 0 | T0000 | 1 | Everything else waits for the scaffold. |
| 1 | T0001, T0003, T0004, T0005, T0022 | 5 | Independent leaf modules, plus fixture vendoring. |
| 2 | T0002, T0006, T0019 | 3 | |
| 3 | T0007, T0008, T0009, T0023 | 4 | T0008 is on the critical path; staff it first. |
| 4 | T0010, T0011, T0012, T0013, T0014, T0015, T0016, T0017, T0018 | up to 9 | Function groups only add files in `src/functions/`, so they rarely conflict. |
| 5 | T0020, T0024 | 2 | |
| 6 | T0021 | 1 | |
| 7 | T0025 | 1 | Phase 1 complete → release 0.1.0. |
| 8 | T0026–T0034 | up to 9 | STU features, FHIR phase 2, performance and CLI, all independent. |

**Critical path:** T0000 → T0001 → T0002 → T0008 → T0018 → T0020 → T0021 → T0025. Delays on these tasks delay the 0.1.0 release. Everything else has slack.

**Conformance becomes measurable** once T0008, T0022 and T0023 are merged (end of wave 3). From wave 4 on, every PR reports its conformance delta.

**Phase 2 (T0026–T0032)** implements the STU parts of N1 and the additions in [FHIRPath 3.0.0](https://hl7.org/fhirpath/STU3/). These tasks are independent of each other and can all run in parallel after 0.1.0. Each one must make its matching conformance tests (those classified *STU*) pass, and update the scope table in [architecture.md](architecture.md#specification-baseline-and-scope).

## Backlog (not scheduled)

- R4B and R6 models (mostly a generator run once T0019 exists).
- Parser error recovery and a language-server or editor integration.
- FHIR XML as an input format (a separate package that reuses the T0023 converter).
- A SQL-on-FHIR `ViewDefinition` runner built on Callis.
- A differential test harness against `fhirpath.js` and the HL7 Java engine.
- An optional "compiled sync-only" build mode, if T0033 shows a significant gain.
