/**
 * The model-aware options of the public API, `model`, `inputType` and `lenient`
 * ([T0038a](../../../docs/tasks/T0038a-public-model-options.md)), against the generated R4, R5
 * and R6 providers. The engine behind them is tested through the internal API in
 * `generated-models.test.ts`; these tests check that the public entry point passes the options
 * on unchanged and validates them. The R6 provider is a draft snapshot; no R6 conformance is
 * claimed.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { r4 } from '../../fhir-r4/src/index.ts';
import { r5 } from '../../fhir-r5/src/index.ts';
import { r6 } from '../../fhir-r6/src/index.ts';
import * as internal from '../src/api/compile.ts';
import {
  analyze,
  type CompileOptions,
  compile,
  evaluate,
  FhirPathEvaluationError,
  type LenientOptions,
  type ModelProvider,
} from '../src/index.ts';

const birthTime = {
  url: 'http://hl7.org/fhir/StructureDefinition/patient-birthTime',
  valueDateTime: '1974-12-25T14:35:45-05:00',
};

/** Synthetic data whose elements exist unchanged in R4, R5 and R6. */
const patient = {
  resourceType: 'Patient',
  id: 'p1',
  name: [{ use: 'official', given: ['Peter', 'James'], family: 'Chalmers' }],
  birthDate: '1974-12-25',
  _birthDate: { extension: [birthTime] },
  deceasedBoolean: false,
  contained: [{ resourceType: 'Observation', id: 'o1', status: 'final' }],
};

const observation = {
  resourceType: 'Observation',
  status: 'final',
  code: { text: 'weight' },
  valueQuantity: { value: 185, unit: 'lbs', system: 'http://unitsofmeasure.org', code: '[lb_av]' },
};

/** An R6 resource ([DeviceAlert](https://hl7.org/fhir/6.0.0-snapshot1/devicealert.html)). */
const alert = { resourceType: 'DeviceAlert', status: 'in-progress', label: 'SpO2 low' };

const PROVIDERS = [
  // `Observation.triggeredBy` is an element in R5 and R6 only
  // (https://hl7.org/fhir/R5/observation-definitions.html#Observation.triggeredBy); `DeviceAlert`
  // is a resource in R6 only.
  { label: 'R4', model: r4, triggeredBy: false, deviceAlert: false },
  { label: 'R5', model: r5, triggeredBy: true, deviceAlert: false },
  { label: 'R6', model: r6, triggeredBy: true, deviceAlert: true },
] as const;

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
      return error.code;
    }
    throw error;
  }
  return undefined;
}

describe.each(PROVIDERS)(
  'public model option with $label',
  ({ model, triggeredBy, deviceAlert }) => {
    // https://hl7.org/fhirpath/N1/#models, https://hl7.org/fhir/R5/fhirpath.html#polymorphism
    it('navigates choice elements and FHIR primitives with the model', () => {
      expect(evaluate(patient, 'Patient.deceased', { model })).toEqual([false]);
      expect(evaluate(patient, 'Patient.deceased')).toEqual([]);
      expect(evaluate(observation, 'Observation.value.ofType(Quantity).value', { model })).toEqual([
        185,
      ]);
      expect(evaluate(patient, 'Patient.birthDate.extension.url', { model })).toEqual([
        birthTime.url,
      ]);
      expect(evaluate(patient, 'Patient.birthDate', { model })).toEqual(['1974-12-25']);
      expect(
        compile('Patient.contained.ofType(Observation).id', { model }).evaluate(patient),
      ).toEqual(['o1']);
    });

    // https://hl7.org/fhir/R5/fhirpath.html#types: FHIR primitives are System values.
    it('compares FHIR primitives as System values', () => {
      expect(evaluate(patient, 'Patient.birthDate = @1974-12-25', { model })).toEqual([true]);
      expect(evaluate(patient, 'Patient.birthDate is FHIR.date', { model })).toEqual([true]);
      expect(evaluate(patient, 'Patient.name.given.first() is System.String', { model })).toEqual([
        false,
      ]);
    });

    it('gives the results of the internal API for the same options', () => {
      for (const [input, expression] of [
        [patient, 'Patient.name.where(use = %code).given'],
        [patient, 'descendants().count()'],
        [patient, 'children().ofType(HumanName).family'],
        [observation, 'Observation.value.unit'],
        [observation, "Observation.value > 80 'kg'"],
      ] as const) {
        const options = { model, variables: { code: 'official' } };
        expect(evaluate(input, expression, options)).toEqual(
          internal.evaluate(input, expression, options),
        );
      }
    });

    // docs/tasks/T0024a-static-analysis-diagnostics.md
    it('analyzes against the input type', () => {
      const options = { model, inputType: 'Patient' };
      expect(codeOf(() => compile('name.given1', options))).toBe('semantic/unknown-element');
      expect(analyze('name.given1', options).diagnostics[0]).toMatchObject({
        severity: 'error',
        code: 'semantic/unknown-element',
      });
      expect(analyze('name.given', options).diagnostics).toEqual([]);
      expect(codeOf(() => compile('Encounter.status', options))).toBe('semantic/type-mismatch');
      expect(compile('name.given1', { model }).evaluate(patient)).toEqual([]);
      const triggered = analyze('Observation.triggeredBy', { model, inputType: 'Observation' });
      expect(triggered.diagnostics.map((d) => d.code)).toEqual(
        triggeredBy ? [] : ['semantic/unknown-element'],
      );
      expect(codeOf(() => compile('given', { model, inputType: ['Patient', 'Observation'] }))).toBe(
        'semantic/unknown-element',
      );
      expect(
        compile('id', { model, inputType: ['Patient', 'Observation'] }).evaluate(patient),
      ).toEqual(['p1']);
      expect(codeOf(() => compile('status', { model, inputType: 'DeviceAlert' }))).toBe(
        deviceAlert ? undefined : 'semantic/unknown-type',
      );
      if (deviceAlert) {
        expect(evaluate(alert, 'label', { model, inputType: 'DeviceAlert' })).toEqual(['SpO2 low']);
      }
    });

    // https://hl7.org/fhirpath/N1/#type-safety-and-strict-evaluation
    it('applies strict mode with the cardinalities of the model', () => {
      const expression = "Patient.name.given = 'Peter'";
      expect(evaluate(patient, expression, { model, inputType: 'Patient' })).toEqual([false]);
      expect(codeOf(() => compile(expression, { model, inputType: 'Patient', strict: true }))).toBe(
        'semantic/singleton-expected',
      );
      expect(compile("name.given = 'Peter'", { model, strict: true }).evaluate(patient)).toEqual([
        false,
      ]);
    });

    // ADR-0012: choice types are strict unless lenient.choiceSuffix is set.
    it('accepts a choice element with its type suffix only when lenient', () => {
      const expression = 'Observation.valueQuantity.unit';
      const options = { model, inputType: 'Observation' };
      const diagnostic = analyze(expression, options).diagnostics[0];
      expect(diagnostic).toMatchObject({
        code: 'semantic/unknown-element',
        hint: 'value.ofType(Quantity)',
      });
      expect(codeOf(() => compile(expression, options))).toBe('semantic/unknown-element');
      const lenient = { ...options, lenient: { choiceSuffix: true } };
      expect(analyze(expression, lenient).diagnostics).toEqual([]);
      expect(evaluate(observation, expression, lenient)).toEqual(['lbs']);
      expect(evaluate(observation, expression, { model, lenient: { choiceSuffix: true } })).toEqual(
        ['lbs'],
      );
      // The leading type name tells analysis the type; without it, the suffixed name is empty.
      const noSuffix = { model, lenient: { choiceSuffix: false } };
      expect(codeOf(() => evaluate(observation, expression, noSuffix))).toBe(
        'semantic/unknown-element',
      );
      expect(evaluate(observation, 'valueQuantity.unit', noSuffix)).toEqual([]);
    });
  },
);

describe('public model-aware option validation', () => {
  /** A provider with r4's data and the given namespace. */
  function provider(namespace: unknown): ModelProvider {
    return {
      namespace,
      version: r4.version,
      getType: (name) => r4.getType(name),
      getRootType: (json) => r4.getRootType(json),
      getElement: (type, name) => r4.getElement(type, name),
      getElements: (type) => r4.getElements(type),
      isSubtypeOf: (type, ancestor) => r4.isSubtypeOf(type, ancestor),
      getSystemType: (type) => r4.getSystemType(type),
    } as ModelProvider;
  }

  it('accepts a provider that is not one of the generated ones', () => {
    expect(evaluate(patient, 'Patient.deceased', { model: provider('FHIR') })).toEqual([false]);
  });

  // https://github.com/losol/callis/issues/60: a System namespace would shadow the System types.
  it.each([
    ['System', provider('System')],
    ['empty', provider('')],
    ['not a string', provider(1)],
    ['without a version', { ...provider('FHIR'), version: undefined }],
    ['missing a method', { ...provider('FHIR'), getSystemType: undefined }],
    ['null', null],
    ['a string', 'r4'],
  ])('rejects a model namespace or contract that is %s', (_, model) => {
    const options = { model } as unknown as CompileOptions;
    for (const run of [
      () => compile('1', options),
      () => analyze('1', options),
      () => evaluate(null, '1', options),
    ]) {
      expect(run).toThrow(FhirPathEvaluationError);
      expect(codeOf(run)).toBe('eval/invalid-argument');
    }
  });

  it.each([
    ['without a model', { inputType: 'Patient' }],
    ['not a name', { model: r4, inputType: 1 }],
    ['an array with a non-name', { model: r4, inputType: ['Patient', 1] }],
    // biome-ignore lint/suspicious/noSparseArray: a hole is not a type name.
    ['an array with a hole', { model: r4, inputType: [, 'Patient'] }],
    ['a set', { model: r4, inputType: new Set(['Patient']) }],
  ])('rejects an inputType %s', (_, options) => {
    expect(codeOf(() => compile('1', options as never))).toBe('eval/invalid-argument');
    expect(codeOf(() => analyze('1', options as never))).toBe('eval/invalid-argument');
  });

  it('takes inputType as the names that were checked', () => {
    let reads = 0;
    const names = ['Patient'];
    const changing = new Proxy(names, {
      get(target, key, receiver) {
        if (key === '0' && reads++ > 0) return 'Observation';
        return Reflect.get(target, key, receiver);
      },
    });
    expect(codeOf(() => compile('status', { model: r4, inputType: changing }))).toBe(
      'semantic/unknown-element',
    );
    expect(analyze('name', { model: r4, inputType: [] }).diagnostics).toEqual([]);
  });

  it.each([
    ['a string', 'yes'],
    ['an array', []],
    ['an unknown relaxation', { choiceSuffix: true, anything: true }],
    ['a non-boolean choiceSuffix', { choiceSuffix: 'yes' }],
  ])('rejects a lenient option that is %s', (_, lenient) => {
    const options = { model: r4, lenient } as never;
    expect(codeOf(() => compile('1', options))).toBe('eval/invalid-argument');
    expect(codeOf(() => evaluate(null, '1', options))).toBe('eval/invalid-argument');
  });

  it('treats an option that is undefined as not given', () => {
    // JavaScript callers can pass undefined despite exactOptionalPropertyTypes.
    const options = { model: undefined, inputType: undefined, lenient: undefined } as never;
    expect(evaluate(patient, 'Patient.deceased', options)).toEqual([]);
    expect(evaluate(observation, 'valueQuantity.unit', { model: r4, lenient: {} })).toEqual([]);
  });

  it('types the options', () => {
    expectTypeOf<CompileOptions['model']>().toEqualTypeOf<ModelProvider | undefined>();
    expectTypeOf<CompileOptions['inputType']>().toEqualTypeOf<
      string | readonly string[] | undefined
    >();
    expectTypeOf<CompileOptions['lenient']>().toEqualTypeOf<LenientOptions | undefined>();
    expectTypeOf<keyof LenientOptions>().toEqualTypeOf<'choiceSuffix'>();
    expectTypeOf(r4).toExtend<ModelProvider>();
    expectTypeOf(r5).toExtend<ModelProvider>();
    expectTypeOf(r6).toExtend<ModelProvider>();
    expectTypeOf(evaluate(patient, 'name', { model: r6, inputType: 'Patient' })).toEqualTypeOf<
      unknown[]
    >();
  });
});
