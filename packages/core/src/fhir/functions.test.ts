import { describe, expect, it } from 'vitest';
import { stubModel } from '../../test/support/stub-model.ts';
import {
  type CompileOptions,
  compile,
  type EvaluateOptions,
  evaluate,
  evaluateAsync,
} from '../api/compile.ts';
import { createRegistry } from '../functions/registry.ts';
import { parseJson } from '../model/lossless-json.ts';
import { ModelNode } from '../model/model-node.ts';
import { DateValue } from '../values/datetime/date.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import { FHIR_FUNCTIONS } from './functions.ts';

const BIRTH_TIME = 'http://hl7.org/fhir/StructureDefinition/patient-birthTime';
const ABSENT = 'http://hl7.org/fhir/StructureDefinition/data-absent-reason';

// Synthetic data in the shape of the suite's patient-example and patient-name-extensions.
const patient = {
  resourceType: 'Patient',
  extension: [
    { url: 'https://example.org/a', valueString: 'one' },
    { url: 'https://example.org/b', valueBoolean: true },
    { url: 'https://example.org/a', valueString: 'two' },
  ],
  active: true,
  _active: { extension: [{ url: 'https://example.org/c', valueCode: 'confirmed' }] },
  name: [
    {
      family: 'Chalmers',
      given: [null, 'Peter'],
      _given: [{ extension: [{ url: ABSENT, valueCode: 'unknown' }] }, null],
    },
  ],
  gender: 'male',
  birthDate: '1974-12-25',
  _birthDate: { extension: [{ url: BIRTH_TIME, valueDateTime: '1974-12-25T14:35:45-05:00' }] },
};

function run(
  input: unknown,
  expression: string,
  options: CompileOptions & EvaluateOptions = {},
): unknown[] {
  return evaluate(input, expression, options);
}

function typed(input: unknown, expression: string): unknown[] {
  return run(input, expression, { model: stubModel, output: 'typed' });
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe('the FHIR functions in the registry', () => {
  it('are in the default registry and left out with fhir: false', () => {
    const names = FHIR_FUNCTIONS.map((definition) => definition.name);
    expect(names).toEqual([
      'extension',
      'hasValue',
      'getValue',
      'resolve',
      'memberOf',
      'subsumes',
      'subsumedBy',
      'conformsTo',
      'htmlChecks',
    ]);
    const all = createRegistry();
    const standard = createRegistry({ fhir: false });
    for (const name of names) {
      expect(all.get(name)?.name).toBe(name);
      expect(standard.get(name)).toBeUndefined();
    }
    expect(() => compile('extension()', { functions: all })).toThrow(
      expect.objectContaining({ code: 'semantic/wrong-arity' }),
    );
    expect(() => compile('hasValue()', { functions: standard })).toThrow(
      expect.objectContaining({ code: 'semantic/unknown-function' }),
    );
  });
});

// https://hl7.org/fhir/R5/fhirpath.html#functions (testExtension1–3)
describe('extension(url)', () => {
  it('filters the extensions of a primitive by url, with a model', () => {
    expect(
      run(patient, `Patient.birthDate.extension('${BIRTH_TIME}').value`, { model: stubModel }),
    ).toEqual(['1974-12-25T14:35:45-05:00']);
    expect(
      run(patient, 'Patient.birthDate.extension(%`ext-patient-birthTime`).exists()', {
        model: stubModel,
      }),
    ).toEqual([true]);
    expect(
      run(patient, `Patient.birthDate.extension('${BIRTH_TIME}1').count()`, { model: stubModel }),
    ).toEqual([0]);
  });

  it('works on an extension-only primitive', () => {
    expect(
      run(patient, "Patient.active.extension('https://example.org/c').value", {
        model: stubModel,
      }),
    ).toEqual(['confirmed']);
    expect(
      run(patient, `Patient.name.given[0].extension('${ABSENT}').value`, { model: stubModel }),
    ).toEqual(['unknown']);
  });

  it('keeps the order and duplicates of the matching extensions, with and without a model', () => {
    for (const model of [undefined, stubModel]) {
      const options: CompileOptions = model === undefined ? {} : { model };
      expect(run(patient, "Patient.extension('https://example.org/a').value", options)).toEqual(
        model === undefined ? [] : ['one', 'two'],
      );
      expect(
        run(patient, "Patient.extension('https://example.org/a').valueString", options),
      ).toEqual(model === undefined ? ['one', 'two'] : []);
      const [first] = typed(patient, "Patient.extension('https://example.org/a')");
      expect(first).toBeInstanceOf(ModelNode);
      expect((first as ModelNode).value).toBe(patient.extension[0]);
    }
  });

  it('cannot reach the _name extensions of a primitive without a model', () => {
    // Model-less navigation does not merge _birthDate (docs/spec-notes.md#children-without-a-model).
    expect(run(patient, `Patient.birthDate.extension('${BIRTH_TIME}')`)).toEqual([]);
  });

  it('is empty for empty input, an empty url and items that are not input nodes', () => {
    expect(run(patient, "Patient.missing.extension('https://example.org/a')")).toEqual([]);
    expect(run(patient, 'Patient.extension({}).count()')).toEqual([0]);
    expect(run(patient, "Patient.extension('').count()")).toEqual([0]);
    expect(run(patient, "'text'.extension('https://example.org/a')")).toEqual([]);
  });

  it('needs a single String url, also for empty input', () => {
    expect(codeOf(() => run(patient, "Patient.extension('a' | 'b')"))).toBe(
      'eval/singleton-expected',
    );
    expect(codeOf(() => run(patient, '{}.extension(1)'))).toBe('eval/type-mismatch');
  });
});

// https://hl7.org/fhir/R5/fhirpath.html#functions, docs/spec-notes.md#hasvalue-is-always-a-boolean
describe('hasValue() and getValue()', () => {
  it.each<[string, boolean]>([
    // testHasCodingValue1, testHasCodingValue2
    ['Patient.name.given[1]', true],
    ['Patient.name', false],
    // testNoValueHasValue: a primitive with only extensions
    ['Patient.name.given[0]', false],
    ['Patient.active', true],
    ['Patient.birthDate', true],
    ['Patient.gender', true],
    // Empty input and more than one item
    ['Patient.missing', false],
    ['Patient.name.given', false],
    ['Patient.extension', false],
  ])('%s.hasValue() is %s with the model', (path, expected) => {
    expect(run(patient, `${path}.hasValue()`, { model: stubModel })).toEqual([expected]);
  });

  it('reads the JSON value without a model', () => {
    expect(run(patient, 'Patient.gender.hasValue()')).toEqual([true]);
    expect(run(patient, 'Patient.name.hasValue()')).toEqual([false]);
    // Without a model, the null placeholder is no node at all.
    expect(run(patient, 'Patient.name.given.hasValue()')).toEqual([true]);
  });

  it('treats a System primitive as having a value, but not a Quantity', () => {
    expect(run(null, "'a'.hasValue() and 1.hasValue() and @2020.hasValue()")).toEqual([true]);
    expect(run(null, "5 'mg'.hasValue()")).toEqual([false]);
  });

  it('gives the System value without the model type or extensions', () => {
    const [date] = typed(patient, 'Patient.birthDate.getValue()');
    expect(date).toBeInstanceOf(DateValue);
    expect(
      run(patient, 'Patient.birthDate.getValue() is System.Date', { model: stubModel }),
    ).toEqual([true]);
    expect(run(patient, 'Patient.birthDate is System.Date', { model: stubModel })).toEqual([false]);
    expect(run(patient, 'Patient.birthDate.getValue().extension', { model: stubModel })).toEqual(
      [],
    );
    expect(run(patient, 'Patient.name.given[1].getValue()', { model: stubModel })).toEqual([
      'Peter',
    ]);
  });

  it('keeps the precision of a lossless decimal', () => {
    const observation = parseJson(
      '{"resourceType": "Observation", "valueQuantity": {"value": 1.50}}',
    );
    const [value] = run(observation, 'Observation.value.value.getValue()', {
      model: stubModel,
      output: 'typed',
    });
    expect(value).toEqual(Decimal.parse('1.50'));
    expect(String(value)).toBe('1.50');
  });

  it('is empty where hasValue() is false', () => {
    for (const path of ['Patient.name', 'Patient.name.given[0]', 'Patient.name.given']) {
      expect(run(patient, `${path}.getValue()`, { model: stubModel })).toEqual([]);
    }
  });
});

// https://hl7.org/fhir/R5/fhirpath.html#functions; the hooks are T0021.
describe('functions that need a host hook', () => {
  it.each([
    "Patient.gender.memberOf('http://hl7.org/fhir/ValueSet/administrative-gender')",
    "Patient.gender.subsumes('male')",
    "Patient.gender.subsumedBy('male')",
    "conformsTo('http://hl7.org/fhir/StructureDefinition/Patient')",
    'Patient.gender.htmlChecks()',
  ])('%s is empty without a hook, in sync and async mode', async (expression) => {
    expect(run(patient, expression, { model: stubModel })).toEqual([]);
    expect(await evaluateAsync(patient, expression, { model: stubModel })).toEqual([]);
  });

  it('still evaluates its arguments', () => {
    expect(codeOf(() => run(patient, "conformsTo('a'.substring('x'))"))).toBe('eval/type-mismatch');
  });
});
