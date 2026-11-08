# T0032 — FHIR phase 2: structure functions and R5 service APIs

Part of the [roadmap](../roadmap.md). Phase 2 · wave 8 · size L.

- **Depends on:** [T0038](T0038-public-api-completion.md)
- **Area:** `area:functions`, `area:models`
- **Tier hint:** likely `risk:high`: a new entry point in the model packages and an extended `TerminologyProvider`, so the core tier.

## Goal

- `elementDefinition()`, `slice(structure, name)` and `checkModifiers(modifier)`. These need richer model metadata, delivered through a separate entry point of the model packages.
- The draft R5 APIs ([R5 §2.1.9.3–2.1.9.5](https://hl7.org/fhir/R5/fhirpath.html#txapi)), all hook-based:
  - `%terminologies` (`expand`, `lookup`, `validateVS`, `validateCS`, `subsumes`, `translate`) through an extended `TerminologyProvider`
  - `%server`
  - `%factory`

## FHIR versions

The [roadmap rules](../roadmap.md#fhir-versions) apply. The versions differ more here than in phase 1:

- **Richer metadata:** the separate entry point exists for each of `@callis/fhir-r4`, `@callis/fhir-r5` and `@callis/fhir-r6`, generated from the same pinned sources as their navigation data. R6's comes from the pinned `6.0.0-snapshot1` draft, and its README names that limit.
- **Structure functions:** R4, R5 and the R6 draft define `elementDefinition()`, `slice()` and `checkModifiers()` ([R6 §2.1.9.3](https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html#functions)). Their tests run against all three providers.
- **Service APIs:** R4 defines only `%terminologies` ([R4 §2.9.3](https://hl7.org/fhir/R4/fhirpath.html#txapi)), and R5 defines all three APIs. The R6 draft moved all three out of the core specification into HL7's API incubator IG (FHIR-54742, FHIR-54745 and FHIR-54746 in the page's change notes), which has only a CI build and no published, pinnable version.

### Owner decision: R6 service APIs

**Decided by the owner (2026-11-08):** the scope is the R4/R5 service APIs. Under R6, `%terminologies`, `%server` and `%factory` wait until the HL7 API incubator IG is published as a release that Callis can pin; a CI build does not count ([T0039](T0039-fhir-r6-model.md#pinned-source-and-maturity)). Until then they are a known R6 gap, and the docs say so. Following the roadmap rule, the engine adds no version check: with an R6 provider the APIs behave as defined for R5, and the docs call that unspecified for R6, not R6 support.

## Acceptance criteria

The `%terminologies` cases of `TerminologyTests` (R5 suite only) pass with a fake provider; the default model packages do not grow in size; the APIs are marked experimental in the docs. The structure functions pass the same cases against the real `r4`, `r5` and `r6` providers. The docs list the R6 service APIs as a known gap until the HL7 API incubator IG is published ([owner decision](#owner-decision-r6-service-apis)), and claim no R6 conformance result.
