# @callis/fhir-r6

## 0.1.2

### Patch Changes

- 598601d: Type the `id` of every resource as `id` and the `id` of every other element as `string`, as the published definitions do. The R4 model typed every resource `id` as `string`, so `Patient.id is id` was false and the HL7 test `testContainedId` could not pass. The R6 draft model typed 116 of its 124 resources the same way, and the R5 model typed the `id` of 46 datatypes (`Address.id`, `Age.id`, …) as `id` instead of `string`. Code that tests or reads these types now sees the types above.
- f408d5e: The package's `homepage` link on npm now opens its page on the documentation site, for example <https://callis.losol.no/packages/core/>, instead of its directory on GitHub.
- Updated dependencies [c7addb8]
- Updated dependencies [0fea378]
- Updated dependencies [0c82a86]
- Updated dependencies [e1b034d]
- Updated dependencies [0cbee45]
- Updated dependencies [582aff4]
- Updated dependencies [6a7d079]
- Updated dependencies [3186680]
- Updated dependencies [643512a]
- Updated dependencies [2b5fd1a]
- Updated dependencies [f408d5e]
- Updated dependencies [b4e3717]
- Updated dependencies [5468cc1]
- Updated dependencies [27ea77f]
- Updated dependencies [ef00a4b]
  - @callis/core@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [ac436db]
- Updated dependencies [391ed2a]
  - @callis/core@0.2.0

## 0.1.0

### Minor Changes

- 662762c: Add the immutable `r6` ModelProvider generated from the pinned official HL7 FHIR R6 `6.0.0-snapshot1` September 2026 draft snapshot. Include R6 resources, datatypes, choices, inheritance, primitives and recursive backbone metadata, with deterministic source inventory and provenance notices. This provides model metadata; public model-aware evaluation and R6 FHIRPath conformance are separate work. The source is a draft snapshot, not final R6.

### Patch Changes

- Updated dependencies [049b205]
- Updated dependencies [344d7e8]
- Updated dependencies [95cf7fd]
- Updated dependencies [e2c7274]
- Updated dependencies [44b1ac6]
- Updated dependencies [da7c6f7]
- Updated dependencies [0bf76ff]
- Updated dependencies [4730457]
- Updated dependencies [cc25fd7]
  - @callis/core@0.1.0
