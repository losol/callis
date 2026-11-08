/**
 * The conversion functions on typed FHIR data, against the generated R4, R5 and R6 providers
 * ([T0014](../../../docs/tasks/T0014-fn-conversion.md), [FHIR versions](../../../docs/roadmap.md#fhir-versions)).
 * They read the System value of a typed node ([T0018](../../../docs/tasks/T0018-model-aware-evaluation.md#modelnode)),
 * so every provider gives the same results. The R6 provider is a draft snapshot; these tests make
 * no R6 conformance claim.
 */
import { describe, expect, it } from 'vitest';
import { r4 } from '../../fhir-r4/src/index.ts';
import { r5 } from '../../fhir-r5/src/index.ts';
import { r6 } from '../../fhir-r6/src/index.ts';
import { evaluate } from '../src/api/compile.ts';
import { parseJson } from '../src/model/lossless-json.ts';
import type { ModelProvider } from '../src/model/model-provider.ts';
import { DateValue } from '../src/values/datetime/date.ts';
import { DateTimeValue } from '../src/values/datetime/datetime.ts';

const UCUM = 'http://unitsofmeasure.org';

/** Synthetic data whose elements exist unchanged in R4, R5 and R6. */
const patient = {
  resourceType: 'Patient',
  active: true,
  gender: 'male',
  birthDate: '1974-12-25',
  name: [
    {
      family: 'Chalmers',
      given: ['Peter', null],
      _given: [
        null,
        { extension: [{ url: 'https://example.org/syllables', valueString: 'five' }] },
      ],
    },
  ],
};

/** Parsed losslessly, so the decimal keeps the precision `185.50`. */
const observation = parseJson(
  JSON.stringify({
    resourceType: 'Observation',
    status: 'final',
    issued: '2016-03-28T10:30:00Z',
    valueQuantity: { value: 185, unit: 'lbs', system: UCUM, code: '[lb_av]' },
  }).replace('185', '185.50'),
);

/** A FHIR Quantity without a UCUM code, which is not a System Quantity. */
const withoutCode = {
  resourceType: 'Observation',
  status: 'final',
  valueQuantity: { value: 185, unit: 'lbs' },
};

const PROVIDERS: ReadonlyArray<readonly [string, ModelProvider]> = [
  ['R4', r4],
  ['R5', r5],
  ['R6', r6],
];

describe.each(PROVIDERS)('conversion functions with the generated %s provider', (_label, model) => {
  const run = (input: unknown, expression: string): unknown[] =>
    evaluate(input, expression, { model });
  const typed = (input: unknown, expression: string): unknown[] =>
    evaluate(input, expression, { model, output: 'typed' });

  // https://hl7.org/fhirpath/N1/#tostring-string, https://hl7.org/fhir/R5/fhirpath.html#types
  it('converts FHIR primitives through their System value', () => {
    expect(run(patient, 'Patient.birthDate.toString()')).toEqual(['1974-12-25']);
    expect(run(patient, 'Patient.gender.toString()')).toEqual(['male']);
    // The result is a System.String, not the FHIR.code it came from.
    expect(run(patient, 'Patient.gender.toString() is System.String')).toEqual([true]);
    expect(run(patient, 'Patient.active.toString()')).toEqual(['true']);
    expect(run(patient, 'Patient.active.toInteger()')).toEqual([1]);
    expect(run(observation, 'Observation.issued.toString()')).toEqual(['2016-03-28T10:30:00Z']);
    expect(run(observation, 'Observation.value.value.toString()')).toEqual(['185.50']);
    const [date] = typed(patient, 'Patient.birthDate.toDate()');
    expect(date).toBeInstanceOf(DateValue);
    const [dateTime] = typed(patient, 'Patient.birthDate.toDateTime()');
    expect(dateTime).toBeInstanceOf(DateTimeValue);
    expect(String(dateTime)).toBe('1974-12-25');
    expect(run(observation, 'Observation.issued.toDate()')).toEqual(['2016-03-28']);
  });

  // https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html#fn-toString
  it('gives empty for a primitive that has only extensions', () => {
    expect(run(patient, 'Patient.name.given[1].exists()')).toEqual([true]);
    for (const fn of ['toString', 'convertsToString', 'toBoolean', 'convertsToInteger']) {
      expect(run(patient, `Patient.name.given[1].${fn}()`)).toEqual([]);
    }
    // iif() still sees the node as its single input item.
    expect(run(patient, "Patient.name.given[1].iif(true, 'yes')")).toEqual(['yes']);
  });

  it('does not convert a complex value', () => {
    expect(run(patient, 'Patient.name.toString()')).toEqual([]);
    expect(run(patient, 'Patient.name.convertsToString()')).toEqual([false]);
    expect(run(patient, 'Patient.toString()')).toEqual([]);
  });

  // docs/spec-notes.md#tostring-of-a-fhir-quantity
  it('converts a FHIR Quantity with a UCUM code as a System Quantity, with every provider', () => {
    expect(run(observation, 'Observation.value.toString()')).toEqual(["185.50 '[lb_av]'"]);
    expect(run(observation, 'Observation.value.convertsToString()')).toEqual([true]);
    expect(run(observation, 'Observation.value.toQuantity()')).toEqual([
      { value: 185.5, unit: '[lb_av]', system: UCUM, code: '[lb_av]' },
    ]);
    expect(run(withoutCode, 'Observation.value.toString()')).toEqual([]);
    expect(run(withoutCode, 'Observation.value.convertsToQuantity()')).toEqual([false]);
  });

  it('uses a typed node as the input of iif', () => {
    expect(run(patient, 'Patient.name.iif(family.exists(), family, given[0])')).toEqual([
      'Chalmers',
    ]);
    expect(run(patient, "Patient.birthDate.iif(exists(), toString(), '(unknown)')")).toEqual([
      '1974-12-25',
    ]);
  });
});
