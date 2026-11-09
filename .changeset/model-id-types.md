---
'@callis/fhir-r4': patch
'@callis/fhir-r5': patch
'@callis/fhir-r6': patch
---

Type the `id` of every resource as `id` and the `id` of every other element as `string`, as the published definitions do. The R4 model typed every resource `id` as `string`, so `Patient.id is id` was false and the HL7 test `testContainedId` could not pass. The R6 draft model typed 116 of its 124 resources the same way, and the R5 model typed the `id` of 46 datatypes (`Address.id`, `Age.id`, …) as `id` instead of `string`. Code that tests or reads these types now sees the types above.
