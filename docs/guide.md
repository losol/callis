# Using the minimal public API

Callis provides synchronous evaluation of JSON, without a model or with a FHIR model. The initial API is intentionally small; it is not full phase-1 FHIRPath conformance. See the [conformance reports](https://callis.losol.no/conformance/r5) for measured support and the [roadmap](roadmap.md) for remaining work. No release is implied by the examples below.

## Evaluate or compile

```ts
import { compile, evaluate } from '@callis/core';

export const patient: Readonly<{ resourceType: string; name: readonly { given: readonly string[] }[] }> = {
  resourceType: 'Patient', name: [{ given: ['Ada', 'Mina'] }],
};
export const given: unknown[] = evaluate(patient, 'Patient.name.given');
export const firstGiven: unknown[] = compile('name.given[0]').evaluate(patient);
```

These return `['Ada', 'Mina']` and `['Ada']`. Every evaluation returns a fresh array. Missing paths, null inputs and empty expressions such as `{}` produce `[]`. Array-valued paths flatten into a collection. JSON property access uses own properties only. A root name such as `Patient` matches the input's own `resourceType`; this is not model-aware validation.

`compile(expression: string, options?: CompileOptions)` returns a frozen object with `expression` and `evaluate(input: unknown, options?: EvaluateOptions): unknown[]`. It retains no per-evaluation variables or results. `evaluate(input: unknown, expression: string, options?: CompileOptions & EvaluateOptions): unknown[]` compiles each call; there is no compile cache.

## Options and results

| Option | Where | Meaning |
| --- | --- | --- |
| `units?: UnitSystem` | compile / one-off evaluate | Pure synchronous unit provider; defaults to `minimalUnitSystem`. The existing `@callis/ucum` provider implements this contract for UCUM support. |
| `variables?: Readonly<Record<string, unknown>>` | each evaluation | Own properties keyed by names without `%`. Null and undefined values are defined empty variables; an absent variable raises `eval/undefined-variable`. `context` and `ucum` cannot be redefined; a variable named like a FHIR variable (`resource`, `sct`, …) hides it. |
| `resource?: unknown` | each evaluation | The value of `%resource`, converted like a variable; `null` and `[]` make it empty. By default `%resource` is the input. |
| `rootResource?: unknown` | each evaluation | The value of `%rootResource`, converted like a variable. By default it is `%resource`. `resolve()` looks up contained references (`#id`) in it. |
| `timezoneOffset?: number \| 'local'` | each evaluation | Whole minutes east of UTC within ±840; defaults to UTC. `'local'` reads the host's current offset and is host/time dependent. |
| `decimalOutput?: 'number' \| 'string'` | each evaluation | Decimal and Quantity magnitude rendering; defaults to potentially lossy JavaScript numbers. |

```ts
export const variable: unknown[] = compile('%value').evaluate(null, { variables: { value: 'hello' } });
```

Results use the existing plain output adapter: booleans, strings and Integers are JavaScript primitives; Decimal becomes a number or exact string; Date, DateTime and Time become FHIR strings without `@`; Quantity becomes `{ value, unit, system?, code? }`. UCUM quantities include `system: 'http://unitsofmeasure.org'` and `code`; calendar durations omit them. Input objects come back by reference, without internal navigation/provenance wrappers. Treat returned objects as read-only. The `unknown[]` return type reflects arbitrary input object shapes; `PlainQuantity` describes rendered evaluator quantities.

## Exact Decimal rendering

```ts
export const exactDecimal: unknown[] = evaluate(null, '9007199254740993.1200', { decimalOutput: 'string' });
export const quantityJson: string = JSON.stringify(evaluate(null, "1.200 'mg'", { decimalOutput: 'string' }));
```

The first result is `['9007199254740993.1200']`; the second preserves `"value":"1.200"`. Set `decimalOutput: 'string'` for display or JSON serialization of exact evaluator Decimals and Quantity magnitudes. The default number conversion intentionally may round digits and removes trailing zeros ([ADR-0012](adr/0012-evaluation-defaults.md)). Plain results do not retain FHIRPath type tags, so a Decimal rendered as text cannot be distinguished from a String by its JavaScript type alone.

This option cannot recover digits already lost through `JSON.parse` or a JavaScript numeric literal. Navigated input numbers remain numbers even when `decimalOutput` is `'string'`; the option renders evaluator Decimal values, not every numeric property recursively. Supply an exact `Decimal` value through a variable when the caller already has one. Arbitrary non-JSON host objects, cyclic objects and BigInts are not promised JSON serialization by this API.

## Errors and synchronous behavior

```ts
import { FhirPathError } from '@callis/core';

export function expressionError(): string {
  try {
    compile('Patient.');
    return '';
  } catch (error) {
    if (error instanceof FhirPathError) return error.format();
    throw error;
  }
}
```

Callis errors throw synchronously. `FhirPathSyntaxError` describes invalid syntax; `FhirPathSemanticError` describes compile-time problems such as unknown functions or wrong arity, with `diagnostics`; `FhirPathEvaluationError` describes evaluation failures. All extend `FhirPathError`, with a stable `code`, human-readable `message`, optional `span` and `expression`, and `format()` for an error panel. A span uses UTF-16 offsets, an exclusive `end`, and 1-based `line` and `column`. Not every error has a source span, for example an invalid option.

Catch `FhirPathError` for expression diagnostics and keep other errors separate. JSON parsing is the caller's responsibility: a `JSON.parse` syntax error is not a FHIRPath error, while `parseJson()` below raises `eval/invalid-json`. Exceptions thrown by input accessors or a custom unit provider propagate; they are not converted to empty results. `UnitSystem` must be pure and synchronous. A thenable returned by one of its methods raises `eval/async-in-sync` rather than leaking a Promise.

## Lossless JSON input

`JSON.parse` goes through JavaScript numbers, so `1.50` becomes `1.5` and `9.5e2` becomes `950`. FHIRPath can see that difference, and FHIR keeps the precision of decimals. `parseJson(text)` accepts the same JSON as `JSON.parse` and returns ordinary objects, arrays, strings, Booleans and `null`, with every number as a `JsonNumber` that holds its text (`text`, `toInteger()`, `toDecimal()`, `toNumber()`). Evaluation treats it as the Integer or Decimal it denotes: a number written without a fraction or exponent in the 32-bit range is an Integer, anything else a Decimal with the precision of the text.

```ts
import { parseJson } from '@callis/core';

export const lossless: unknown[] = evaluate(parseJson('{"value": 1.50}'), 'value', {
  decimalOutput: 'string',
});
```

This gives `['1.50']`; without `decimalOutput: 'string'`, `[1.5]`. A result that is an object keeps its `JsonNumber` values; `JSON.stringify()` writes them as numbers, and `String(number)` gives the text. Invalid text raises `eval/invalid-json` with the offset of the problem. Parsing is not limited by the call stack. A `__proto__` key becomes an own property, as with `JSON.parse`. `parseJson` is not in releases up to 0.2.0.

## Static analysis and strict mode

`analyze(expression: string, options?: CompileOptions): AnalysisResult` reports the problems of an expression without compiling it, for editors and other tooling. `diagnostics` lists them in source order, each with a `severity`, a stable `code`, a `message` for people, a `span` where the expression has one, and sometimes a `hint` with a suggested rewrite. An error is what `compile()` and `evaluate()` throw as `FhirPathSemanticError`, with the same list in its `diagnostics`; a syntax error is a diagnostic with its `syntax/…` code. A warning leaves the expression valid.

```ts
import { analyze } from '@callis/core';

export const fractionDiagnostics: readonly unknown[] = analyze('@2020-01-01 + 1.5 days').diagnostics;
export const unknownFunction: readonly unknown[] = analyze('nothing()').diagnostics;
```

The first gives one warning, `semantic/fraction-ignored`: date/time arithmetic ignores the fraction of `1.5 days`, so the expression adds one day, as [FHIRPath 3.0.0](https://hl7.org/fhirpath/STU3/#datetime-arithmetic) says and as before. The second gives one error, `semantic/unknown-function`. Analysis knows the types of literals, operators and functions, and reports what can never work: an operator whose operands it never accepts (`1 + 'a'`) is a warning, because evaluation raises `eval/type-mismatch` there; an input or argument of a type a function never accepts (`'a'.abs()`, `skip('1')`) is an error; a type that does not resolve in `is`, `as` or `ofType()` is a warning, and evaluation raises `eval/unknown-type` as before. Without a model it knows nothing about the elements of the input, so `name.given1` reports nothing; with the `model` and `inputType` options it also checks the elements ([FHIR models](#fhir-models)).

`strict: true`, a compile option, is the strict evaluation of [N1 §11](https://hl7.org/fhirpath/N1/#type-safety-and-strict-evaluation): analysis also rejects a value that may repeat where an operator or function takes a single item, equality between a single item and a collection, a value that is not a Boolean where one is expected, the operator warnings above, and `first()`, `last()`, `tail()`, `skip()`, `take()` or the indexer on `children()` or `descendants()`, whose order is undefined. It changes what compiles, never what an expression evaluates to, and a warning stays a warning.

```ts
import { compile, evaluate, FhirPathError } from '@callis/core';

export const addedDay: unknown[] = evaluate(null, '@2020-01-01 + 1.5 days', { strict: true });

/** The code of the error that strict mode raises, or '' when the expression compiles. */
export function strictCode(expression: string): string {
  try {
    compile(expression, { strict: true });
    return '';
  } catch (error) {
    if (error instanceof FhirPathError) return error.code;
    throw error;
  }
}
```

`addedDay` is `['2020-01-02']`. `strictCode('(1 | 2) < 3')` is `semantic/singleton-expected`, `strictCode('children().first()')` is `semantic/unordered-collection`, and `strictCode('name.given < 3')` is `''`: without a model, how many items `name.given` has is unknown, and strict mode never guesses.

## FHIR models

Without a model, Callis navigates JSON by its keys. With one, navigation is type-directed, as the [FHIR use of FHIRPath](https://hl7.org/fhir/R5/fhirpath.html#types) requires: a choice element is reached by its name without the type suffix (`Patient.deceased`, not `deceasedBoolean`), a FHIR primitive keeps the extensions in its `_name` object, FHIR primitives compare as System values, and `is`, `as` and `ofType()` know the model's types and their inheritance. Pass the model as a compile option: `r4` from `@callis/fhir-r4`, `r5` from `@callis/fhir-r5` or `r6` from `@callis/fhir-r6`. Each package takes `@callis/core` as a peer dependency.

```ts
import { analyze, evaluate } from '@callis/core';
import { r4 } from '@callis/fhir-r4';

export const fhirPatient: Readonly<Record<string, unknown>> = {
  resourceType: 'Patient',
  birthDate: '1974-12-25',
  _birthDate: {
    extension: [
      {
        url: 'http://hl7.org/fhir/StructureDefinition/patient-birthTime',
        valueDateTime: '1974-12-25T14:35:45-05:00',
      },
    ],
  },
  deceasedBoolean: false,
};
export const deceased: unknown[] = evaluate(fhirPatient, 'Patient.deceased', { model: r4 });
export const birthTime: unknown[] = evaluate(fhirPatient, 'Patient.birthDate.extension.value', {
  model: r4,
});
export const elementDiagnostics: readonly unknown[] = analyze('name.given1', {
  model: r4,
  inputType: 'Patient',
}).diagnostics;
```

These give `[false]` (`[]` without the model, since the JSON key is `deceasedBoolean`), `['1974-12-25T14:35:45-05:00']`, and one error, `semantic/unknown-element`, which `compile()` and `evaluate()` throw as `FhirPathSemanticError`.

| Option | Where | Meaning |
| --- | --- | --- |
| `model?: ModelProvider` | compile / one-off evaluate | The data model. Any object that implements `ModelProvider` works; its `namespace` must not be empty or `System`, which would hide the System types. |
| `inputType?: string \| readonly string[]` | compile / analyze / one-off evaluate | The type of the input by its name in the model, such as `'Patient'`, or the types it may have. Needs `model`. |
| `lenient?: { choiceSuffix?: boolean }` | compile / analyze / one-off evaluate | Compatibility relaxations; none by default. |

With `inputType`, analysis reports when the expression is compiled: an element the type does not have (`name.given1`), a leading type name that does not match (`Encounter.status` on a Patient), and a choice element written with its type suffix, with the hint `value.ofType(Quantity)`. A name the model does not define, such as `'DeviceAlert'` in R4, is a `semantic/unknown-type` error. With several types, an element is reported only when none of them has it. In strict mode, the model also tells analysis which elements may repeat, so `Patient.name.given = 'Peter'` is `semantic/singleton-expected`. Without `inputType`, analysis checks what the expression itself makes known, such as the elements after a leading `Patient`.

Choice elements follow the specification by default ([ADR-0012](adr/0012-evaluation-defaults.md)): `Observation.valueQuantity` is a semantic error where analysis knows the type and empty where it does not, and the specification's form is `Observation.value.ofType(Quantity)`. `lenient: { choiceSuffix: true }` accepts the suffixed name, as other engines do. Any other key in `lenient` raises `eval/invalid-argument`.

```ts
import { evaluate } from '@callis/core';
import { r4 } from '@callis/fhir-r4';
import { r6 } from '@callis/fhir-r6';

export const weight: Readonly<Record<string, unknown>> = {
  resourceType: 'Observation',
  valueQuantity: { value: 185, unit: 'lbs', system: 'http://unitsofmeasure.org', code: '[lb_av]' },
};
export const suffixedUnit: unknown[] = evaluate(weight, 'Observation.valueQuantity.unit', {
  model: r4,
  lenient: { choiceSuffix: true },
});
export const alertLabel: unknown[] = evaluate(
  { resourceType: 'DeviceAlert', label: 'SpO2 low' },
  'label',
  { model: r6, inputType: 'DeviceAlert' },
);
```

These give `['lbs']` and `['SpO2 low']`. Results stay plain: a FHIR primitive comes out as its JSON value, and one that has only extensions as its `_name` object.

**Versions.** The engine has no version-specific code; R4, R5 and R6 differ only in the providers' data. R4 (4.0.1) and R5 (5.0.0) are measured with the HL7 test suites ([R4 report](https://callis.losol.no/conformance/r4), [R5 report](https://callis.losol.no/conformance/r5)). R6 is best effort: `r6` is built from the draft [`6.0.0-snapshot1`](https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html), not final R6, and the engine's own tests evaluate with it. There is no official R6 FHIRPath suite, so there is no R6 conformance result. Known gaps of R6 in Callis: the Type Factory (`%factory`), General Service API (`%server`) and Terminology Service API (`%terminologies`), which the draft moved to an HL7 incubator guide and which wait for that guide to be published ([T0032](tasks/T0032-fhir-phase2.md) adds the R4 and R5 ones), and the new `weight()` function, which waits for final R6; `%profile` can be passed as a variable. The [roadmap](roadmap.md#fhir-versions) lists every difference between the draft and R5 and how each is handled.

## Current support and deferred API

Model-less paths, literals, indexing, Boolean logic, unary polarity and type operations are available. The built-in functions are `not`, `is`, `as`, `where`, `select`, `repeat`, `ofType`, `exists`, `count`, `empty`, `all`, `allTrue`, `anyTrue`, `allFalse`, `anyFalse`, `subsetOf`, `supersetOf`, `distinct`, `isDistinct`, `first`, `single`, `last`, `tail`, `skip`, `take`, `intersect`, `exclude`, `union`, `combine`, `children`, `descendants`, `trace`, `now`, `today`, `timeOfDay`, `iif`, `toX()` and `convertsToX()` for Boolean, Integer, Decimal, Date, DateTime, Time, String and Quantity, the string functions and the FHIR functions below. Arithmetic, comparisons, equality/equivalence, membership, union and string concatenation operators from T0010 are implemented. Other standard functions are still incremental work; an unavailable function such as `aggregate()` raises `semantic/unknown-function`, rather than pretending to evaluate it.

Filtering is now available through `where(criteria)`, using the existing synchronous API:

```ts
export const filteredGiven: unknown[] = evaluate(patient, "name.where(given[0] = 'Ada').given");
```

`where` preserves input order, duplicates and input object identity. It evaluates criteria for each item with that item as `$this` and its zero-based input position as `$index`; nested filters have independent frames. True includes the item, false/empty excludes it. Criteria follow the existing FHIRPath singleton Boolean rule: a single non-Boolean item counts as true, including `0` or `''`; this is not JavaScript truthiness or string-to-Boolean conversion. Multiple criterion items raise `eval/singleton-expected`. Empty input returns empty without evaluating the criterion. This increment adds no options, model awareness or public async surface; the version-specific 0.1 matrix below remains historical.

`select(projection)` evaluates the projection for each item, with the item as `$this` and its position as `$index`, and lists the results in order. `repeat(projection)` applies the projection to the input, then to every new item it gives, until no new item comes; an item is new unless it equals (`=`) one already found or is the same element. It walks nested data such as `Questionnaire.item` breadth first, and stops a projection that keeps making new values, such as `'x'.repeat($this & 'x')`, with `eval/limit-exceeded` after 5,000 items. `ofType(type)` keeps the items of a type. Without a model, a resource name such as `Patient` keeps the objects whose own `resourceType` is that name, and a qualified name that does not resolve, such as `FHIR.Patient`, raises `eval/unknown-type`.

```ts
export const firstGivenPerName: unknown[] = evaluate(patient, 'name.select(given.first())');
export const linkIds: unknown[] = evaluate(questionnaire, 'Questionnaire.repeat(item).linkId');
export const onlyPatients: unknown[] = compile('ofType(Patient)').evaluate([patient, questionnaire]);
```

`exists()` returns whether the input has any items, and `count()` returns its item count (including duplicates). Their empty-input results are `[false]` and `[0]`. `exists(criteria)` uses the same per-item predicate helper as `where` and stops as soon as an item matches; later criteria, including their errors, are not evaluated.

```ts
export const numberOfNames: unknown[] = evaluate(patient, 'name.count()');
export const hasAda: unknown[] = compile("name.exists(given[0] = 'Ada')").evaluate(patient);
export const filteredNameCount: unknown[] = evaluate(patient, "name.where(given[0] = 'Ada').count()");
```

`empty()` is the opposite of `exists()`. `all(criteria)` is true when the criterion matches every item, under the same rules as `exists(criteria)`: it stops at the first item that does not match, and empty input gives true. `allTrue()`, `anyTrue()`, `allFalse()` and `anyFalse()` take a collection of Booleans; any other item raises `eval/type-mismatch`. For empty input, `allTrue()` and `allFalse()` give true, and `anyTrue()` and `anyFalse()` false.

```ts
export const noNames: unknown[] = evaluate(patient, 'name.empty()');
export const allGiven: unknown[] = compile('name.all(given.exists())').evaluate(patient);
export const someFalse: unknown[] = evaluate(null, 'true.combine(false).anyFalse()');
```

`subsetOf(other)` is true when every input item is in `other`, and `supersetOf(other)` when every item of `other` is in the input. Membership uses `=`, as `intersect()` does: an item whose equality is undetermined is not a member. `distinct()` leaves out repeated items, keeping the last of equal ones in input order, and `isDistinct()` tells whether nothing repeats. Items repeat only when `=` is true, as for membership: values that cannot be compared, such as `@2020` and `@2020-01-01`, are distinct, as FHIRPath 3.0.0 says (the HL7 tests expect empty there), and an element that holds only extensions is never equal to another item.

```ts
export const knownGiven: unknown[] = evaluate(patient, "name.given.subsetOf('Ada' | 'Mina' | 'Grace')");
export const uniqueGiven: unknown[] = evaluate(patient, "name.given.combine('Ada').distinct()");
export const givenDistinct: unknown[] = compile('name.given.isDistinct()').evaluate(patient);
```

`first()` returns the first item in input order. `single()` returns the item only when there is at most one; multiple items raise `eval/singleton-expected`, including duplicate items. Both return empty for empty input and preserve the selected input object and its provenance.

```ts
export const selectedGiven: unknown[] = evaluate(patient, 'name.given.first()');
export const onlyName: unknown[] = compile('name.single()').evaluate(patient);
```

`last()` returns the last item and `tail()` all items but the first. `skip(num)` leaves out the first `num` items and `take(num)` keeps them, both in input order: a `num` of zero or less gives the input from `skip()` and empty from `take()`, and an empty `num` gives empty from both. `num` is a single Integer; more than one item raises `eval/singleton-expected` and any other type `eval/type-mismatch`.

```ts
export const lastGiven: unknown[] = evaluate(patient, 'name.given.last()');
export const laterGiven: unknown[] = evaluate(patient, 'name.given.skip(1)');
export const firstTwoGiven: unknown[] = evaluate(patient, 'name.given.take(2)');
```

`intersect(other)`, `exclude(other)`, `union(other)` and `combine(other)` compare items with `=`. `intersect()` lists each shared item once, `exclude()` keeps the other items and their duplicates, `union()` is the `|` operator and merges without duplicates, and `combine()` appends `other` and keeps duplicates. Items whose equality is undetermined, such as dates of different precision, are not equal. Every function returns the input items themselves, with their object identity and provenance, in a fixed order: the input first, then the new items of `other`.

```ts
export const withoutAda: unknown[] = evaluate(patient, "name.given.exclude('Ada')");
export const withGrace: unknown[] = compile("name.given.union('Grace')").evaluate(patient);
export const adaTwice: unknown[] = evaluate(patient, "name.given.take(1).combine('Ada')");
```

These functions use the existing synchronous model-less API.

`children()` returns the properties of each input object in document order, with arrays flattened, but not `resourceType` or keys that start with `_`; `descendants()` returns everything below the input, depth first in document order. `now()`, `today()` and `timeOfDay()` give the same value every time within one evaluation, in UTC unless `timezoneOffset` says otherwise. `trace(name[, projection])` returns its input unchanged; the public API has no hooks yet, so nothing receives its output.

The conversion functions are available too: `iif()`, and `toX()` with `convertsToX()` for Boolean, Integer, Decimal, Date, DateTime, Time, String and Quantity.

```ts
export const named: unknown[] = evaluate(patient, "iif(name.exists(), 'named', 'unnamed')");
export const parsedDecimal: unknown[] = evaluate(null, "'1.50'.toDecimal()", { decimalOutput: 'string' });
export const inHours: unknown[] = evaluate(null, "'4 days'.toQuantity('h').toString()");
```

These give `['named']`, `['1.50']` and `["96 'h'"]`. `iif()` evaluates only the branch it selects, with the input as `$this`. A conversion takes one item: empty input gives empty, more than one item raises `eval/singleton-expected`, and a value that does not convert gives empty from `toX()` and false from `convertsToX()`. `toString()` keeps the precision of a Decimal (`1.0` gives `'1.0'`) and writes dates and times without `@`.

String functions work on one String: `indexOf`, `substring`, `startsWith`, `endsWith`, `contains`, `upper`, `lower`, `replace`, `matches`, `replaceMatches`, `length` and `toChars`. An empty input or argument gives an empty result; more than one item raises `eval/singleton-expected` and a value that is not a String `eval/type-mismatch`. Characters are Unicode scalar values, as in FHIRPath 3.0.0, so `'a🔥b'.length()` is `3` and `toChars()` never splits a surrogate pair. `matches()` and `replaceMatches()` use JavaScript regular expressions with the `u` flag in single-line mode: `.` also matches a line break, `^` and `$` match only at the ends of the string, and a pattern that is not valid raises `eval/invalid-argument`. A `replaceMatches()` substitution refers to groups as `${name}` or `${1}`, as in the specification's example, or in JavaScript's forms `$1` and `$<name>`. `matchesFull()`, regular expression flags and the other string functions are deferred.

The FHIR additions ([T0020](tasks/T0020-fhir-functions.md)) are available as well: `extension(url)`, `hasValue()`, `getValue()` and `resolve()`, and the variables `%resource`, `%rootResource`, `%sct`, `%loinc`, `` %`vs-[name]` `` and `` %`ext-[name]` ``. `resolve()` finds what is in the data: a contained resource for `#id`, and an entry of the Bundle around the reference by its `fullUrl`, with a relative `Type/id` taken against the base of the entry the reference is in; anything else gives nothing.

```ts
export const managedBy: unknown[] = evaluate(withContained, 'managingOrganization.resolve().name');
export const containerReference: unknown[] = evaluate(
  organization,
  '%rootResource.managingOrganization.reference',
  { rootResource: withContained },
);
```

These give `['Acme']` and `['#o1']`. `%resource` and `%rootResource` are the input unless the `resource` and `rootResource` options say otherwise, as in the second example, which evaluates a contained resource on its own. `hasValue()` is true for a single item with a primitive value and false otherwise. Without a model, `extension()` finds the extensions of resources and complex values, but not those of a primitive, which sit in its `_name` object; with the `model` option it finds those too ([FHIR models](#fhir-models)). `memberOf()`, `subsumes()`, `subsumedBy()`, `conformsTo()` and `htmlChecks()` compile, but return empty in the public API, which has no hooks yet; the engine's host hooks ([T0021](tasks/T0021-hooks-async.md)) reach it with the expanded API (T0038). The interpretations behind these are in the [spec notes](spec-notes.md#fhir-functions).

The public surface has no parser, AST input/property, typed output mode, async evaluation, hooks, custom function registry ([#222](https://github.com/losol/callis/issues/222)) or cache; the analyzer, the strict option and the model options are described above. Unsupported option keys raise `eval/invalid-argument`. The existing `Decimal`, `UnitSystem`, `minimalUnitSystem` and `ModelProvider` exports remain available to provider packages. The remaining options arrive with the [T0038](tasks/T0038-public-api-completion.md#split) tasks.

The examples are executed by the public documentation tests. Handwritten TSDoc and this small guide describe the initial API; a generated API reference is deferred with the expanded API.

## First 0.1 support matrix

This describes the 0.1.0 subset at engine revision [9b78e6e](https://github.com/losol/callis/tree/9b78e6ef0b65bf535af335677afa65dffc0f0f1d), including the playground layout fix. The five packages were published from `b92db53` on 2026-11-06 UTC with this engine unchanged ([RELEASING](../RELEASING.md#release-tracking)); later releases add to it as described above.

| Surface | Implemented / limit |
| --- | --- |
| Runtimes | CI tests Node 22, 24 and 26; packed ESM/TypeScript plus production Vite/Chromium smoke on Node 24. Deno, Bun, edge workers, Firefox and Safari unverified. |
| Data | Model-less JSON paths, root resourceType matching, literals, indexing, variables and system type operations; no model-driven choice expansion or primitive extensions. |
| Operators | `+ - * / div mod`, unary `+ -`, `&`, `= != ~ !~`, `< <= > >=`, `in contains`, `&#124;`, `and or xor implies`, `is as`. Applicability depends on operand types and FHIRPath empty-collection rules. |
| Functions | `not()`, `is()` and `as()` only. `ofType()`, listed here before, was never registered ([#130](https://github.com/losol/callis/issues/130)). `where`, `select`, `exists`, `resolve` and other standard/FHIR groups are not implemented. |
| Output | Synchronous plain arrays; exact evaluator Decimal/Quantity strings with `decimalOutput: 'string'`; parsed input numbers retain JavaScript precision limits unless the input comes from `parseJson()`, added after 0.1. |
| Errors | Public FhirPathError subclasses, codes, optional UTF-16 source spans, semantic diagnostics and formatting; caller handles invalid JSON separately. |
| Companions | UCUM UnitSystem is usable through `units`; R4, R5 and R6 export immutable ModelProvider data, R6 from the pinned `6.0.0-snapshot1` draft. None provides a public engine `model` option. |
| Deferred | Async, hooks, custom functions, parser/AST, analysis, typed output, model-aware evaluation and remaining function groups; tracked by implementation tasks and T0038. |

The [playground](https://callis.losol.no/playground/) runs editable JSON and expressions locally in the browser, with exact evaluator Decimal string rendering and synthetic presets. It does not automatically transmit input JSON. Its results use the same public API; JSON.parse precision limits still apply.

The generated [R4](https://callis.losol.no/conformance/r4) and [R5](https://callis.losol.no/conformance/r5) reports use the **internal API adapter**, including facilities not exposed by this public facade. Their pass counts are not public model-less API conformance. See the [0.1 inventory](releases/0.1.0.md#conformance) for per-phase counts, exceptions and source pins. Full phase 1 is a later milestone. Later 0.x additions update this matrix; T0038 completes the API later, while 1.0 scope remains an owner decision.

The handwritten API guide and TSDoc are the reference decision for this small release. A generated reference is deferred to T0038. README and guide TypeScript snippets share `examples/public-api.ts`, executed by the documentation tests; the site serves this guide from the same source.

## R6 model metadata

Callis supports FHIR R4, R5 and R6, with R6 as best effort. [T0039](tasks/T0039-fhir-r6-model.md) and [T0040](tasks/T0040-fhir-r6-validation.md) delivered a real R6 provider, `@callis/fhir-r6`, from the pinned HL7 `6.0.0-snapshot1` September 2026 draft source, and it shipped in the [five-package first release](../RELEASING.md#five-package-first-release). This is draft model metadata, not final R6 stability, FHIR validation or an R6 conformance result. It is passed to the public API as the `model` option like `r4` and `r5` ([FHIR models](#fhir-models)). The engine's own tests run model-aware evaluation against the R6 provider alongside R4 and R5, which is engine-tested provider support for the draft snapshot, not an R6 conformance result: there is no official R6 suite, and the existing R4/R5 conformance reports measure their named suites only.

R4, R5 and R6 use the same named-provider API (`r4`, `r5`, `r6`), with `getType(name)` and `getElement(type, name)` for metadata lookup. These are not generated resource classes; the evaluator takes any of them through the same `model` option. Where the R6 draft's FHIRPath page differs from R5, and which later tasks handle those differences, is listed under [FHIR versions](roadmap.md#fhir-versions) in the roadmap.
