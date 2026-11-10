import { describe, expect, it } from 'vitest';
import { hooksFor, MODES } from '../../test/support/hook-modes.ts';
import { stubModel } from '../../test/support/stub-model.ts';
import {
  type CompileOptions,
  compile,
  type EvaluateOptions,
  evaluate,
  evaluateAsync,
} from '../api/compile.ts';
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { createRegistry } from '../functions/registry.ts';
import { parseJson } from '../model/lossless-json.ts';
import { ModelNode } from '../model/model-node.ts';
import type { CodedValue, EvaluationHooks, SubsumptionOutcome } from '../runtime/hooks.ts';
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

// https://hl7.org/fhir/R5/fhirpath.html#functions, docs/tasks/T0021-hooks-async.md#host-hooks,
// docs/spec-notes.md#hook-backed-functions-errors-and-empty-results
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
    // Other hooks do not help.
    const hooks = { trace: () => undefined };
    expect(run(patient, expression, { model: stubModel, hooks })).toEqual([]);
  });

  it('still evaluates and checks its arguments', () => {
    expect(codeOf(() => run(patient, "conformsTo('a'.substring('x'))"))).toBe('eval/type-mismatch');
    expect(codeOf(() => run(patient, 'conformsTo(1)'))).toBe('eval/type-mismatch');
    expect(codeOf(() => run(patient, "Patient.gender.memberOf('a' | 'b')"))).toBe(
      'eval/singleton-expected',
    );
  });
});

const observation = {
  resourceType: 'Observation',
  status: 'final',
  code: {
    coding: [
      { system: 'http://loinc.org', code: '8480-6', display: 'Systolic' },
      { system: 'http://snomed.info/sct', code: '271649006' },
    ],
    text: 'SBP',
  },
  valueQuantity: { value: 120, unit: 'mmHg' },
};

const VS = 'http://example.org/vs';

describe.each(MODES)(
  'memberOf(valueset) with a terminology provider, %s',
  (_label, run, isAsync) => {
    function provider(answer: unknown): {
      readonly calls: [CodedValue, string][];
      readonly hooks: EvaluationHooks;
      readonly options: CompileOptions & EvaluateOptions;
    } {
      const calls: [CodedValue, string][] = [];
      const hooks = hooksFor(
        {
          terminology: {
            memberOf: (coded, valueSet) => {
              calls.push([coded, valueSet]);
              return answer as boolean;
            },
          },
        },
        isAsync,
      );
      return { calls, hooks, options: { model: stubModel, hooks } };
    }

    it('passes a code, a Coding or a CodeableConcept with the value set URL', async () => {
      const { calls, options } = provider(true);
      await expect(
        run(observation, `Observation.status.memberOf('${VS}')`, options),
      ).resolves.toEqual([true]);
      await expect(
        run(observation, 'Observation.code.coding[0].memberOf(%`vs-observation-codes`)', options),
      ).resolves.toEqual([true]);
      await expect(
        run(observation, `Observation.code.memberOf('${VS}')`, options),
      ).resolves.toEqual([true]);
      await expect(run(null, `'final'.memberOf('${VS}')`, options)).resolves.toEqual([true]);
      const loinc = { system: 'http://loinc.org', code: '8480-6', display: 'Systolic' };
      const snomed = { system: 'http://snomed.info/sct', code: '271649006' };
      expect(calls).toEqual([
        [{ kind: 'code', codings: [{ code: 'final' }], value: 'final' }, VS],
        [
          { kind: 'Coding', codings: [loinc], value: loinc },
          'http://hl7.org/fhir/ValueSet/observation-codes',
        ],
        [{ kind: 'CodeableConcept', codings: [loinc, snomed], value: observation.code }, VS],
        [{ kind: 'code', codings: [{ code: 'final' }], value: 'final' }, VS],
      ]);
      expect(calls[1]?.[0].value).toBe(observation.code.coding[0]);
      expect(calls[2]?.[0].value).toBe(observation.code);
    });

    it('gives false and empty as the provider answers', async () => {
      const expression = `Observation.status.memberOf('${VS}')`;
      await expect(run(observation, expression, provider(false).options)).resolves.toEqual([false]);
      await expect(run(observation, expression, provider(undefined).options)).resolves.toEqual([]);
      await expect(run(observation, expression, provider(null).options)).resolves.toEqual([]);
    });

    it('is empty without a call for empty or several items, an uncoded item or no value set', async () => {
      const { calls, options } = provider(true);
      for (const expression of [
        `Observation.missing.memberOf('${VS}')`,
        `Observation.code.coding.memberOf('${VS}')`,
        `Observation.memberOf('${VS}')`,
        `Observation.value.memberOf('${VS}')`,
        "Observation.status.memberOf('')",
        'Observation.status.memberOf({})',
      ]) {
        await expect(run(observation, expression, options)).resolves.toEqual([]);
      }
      expect(calls).toEqual([]);
    });

    it('reads the shape of the data without a model', async () => {
      const { calls, hooks } = provider(true);
      const modelless = { hooks };
      await expect(
        run({ system: 's', code: 'x' }, `memberOf('${VS}')`, modelless),
      ).resolves.toEqual([true]);
      await expect(
        run({ coding: [{ code: 'a' }] }, `memberOf('${VS}')`, modelless),
      ).resolves.toEqual([true]);
      await expect(run({ foo: 1 }, `memberOf('${VS}')`, modelless)).resolves.toEqual([]);
      expect(calls.map(([coded]) => [coded.kind, coded.codings])).toEqual([
        ['Coding', [{ system: 's', code: 'x' }]],
        ['CodeableConcept', [{ code: 'a' }]],
      ]);
    });

    it('raises eval/invalid-argument for an answer that is not a boolean', async () => {
      await expect(
        run(observation, `Observation.status.memberOf('${VS}')`, provider('yes').options),
      ).rejects.toMatchObject({ code: 'eval/invalid-argument' });
    });
  },
);

describe.each(MODES)(
  'subsumes(code) and subsumedBy(code) with a terminology provider, %s',
  (_label, run, isAsync) => {
    const a = { system: 's', code: 'a' };
    const b = { system: 's', code: 'b' };
    const c = { system: 's', code: 'c' };
    const d = { system: 's', code: 'd' };
    const variables = {
      a,
      b,
      aAgain: { system: 's', code: 'a', version: '2', display: 'A' },
      other: { system: 't', code: 'a' },
      ab: { coding: [a, b] },
      bc: { coding: [b, c] },
      cd: { coding: [c, d] },
      none: { coding: [] },
      text: { text: 'no codings' },
    };

    /** A provider whose answers are keyed `a>b` for the pair (a, b). */
    function provider(outcomes: Readonly<Record<string, SubsumptionOutcome | undefined>>): {
      readonly calls: string[];
      readonly options: CompileOptions & EvaluateOptions;
    } {
      const calls: string[] = [];
      const hooks = hooksFor(
        {
          terminology: {
            subsumes: (x, y) => {
              const key = `${x.code}>${y.code}`;
              calls.push(key);
              return outcomes[key];
            },
          },
        },
        isAsync,
      );
      return { calls, options: { variables, hooks } };
    }

    it.each<[SubsumptionOutcome | undefined, unknown[], unknown[]]>([
      ['equivalent', [true], [true]],
      ['subsumes', [true], [false]],
      ['subsumed-by', [false], [true]],
      ['not-subsumed', [false], [false]],
      [undefined, [], []],
    ])('%s from the provider gives subsumes %j and subsumedBy %j', async (outcome, yes, no) => {
      const { calls, options } = provider({ 'a>b': outcome });
      await expect(run(null, '%a.subsumes(%b)', options)).resolves.toEqual(yes);
      await expect(run(null, '%a.subsumedBy(%b)', options)).resolves.toEqual(no);
      expect(calls).toEqual(['a>b', 'a>b']);
    });

    it('knows two codings with the same system and code are equivalent without a call', async () => {
      const { calls, options } = provider({});
      await expect(run(null, '%a.subsumes(%aAgain)', options)).resolves.toEqual([true]);
      await expect(run(null, '%a.subsumedBy(%aAgain)', options)).resolves.toEqual([true]);
      await expect(run(null, '%a.subsumes(%other)', options)).resolves.toEqual([]);
      expect(calls).toEqual(['a>a']);
    });

    it('asks about the pairs of codings of a CodeableConcept until one matches', async () => {
      const { calls, options } = provider({ 'a>b': 'not-subsumed', 'a>c': 'subsumes' });
      await expect(run(null, '%ab.subsumes(%bc)', options)).resolves.toEqual([true]);
      // (a, b), (a, c) match; (b, b) and (b, c) are never asked.
      expect(calls).toEqual(['a>b', 'a>c']);
    });

    it('is false when every pair is known not to match, and empty when one is unknown', async () => {
      const known = provider({
        'a>c': 'not-subsumed',
        'a>d': 'not-subsumed',
        'b>c': 'not-subsumed',
        'b>d': 'subsumed-by',
      });
      await expect(run(null, '%ab.subsumes(%cd)', known.options)).resolves.toEqual([false]);
      expect(known.calls).toEqual(['a>c', 'a>d', 'b>c', 'b>d']);
      const unknown = provider({ 'a>c': 'not-subsumed', 'b>d': 'not-subsumed' });
      await expect(run(null, '%ab.subsumes(%cd)', unknown.options)).resolves.toEqual([]);
      const late = provider({ 'b>d': 'subsumes' });
      await expect(run(null, '%ab.subsumes(%cd)', late.options)).resolves.toEqual([true]);
      // A coding both concepts share is equivalent to itself, whatever the provider says.
      const shared = provider({ 'a>b': 'not-subsumed', 'a>c': 'not-subsumed' });
      await expect(run(null, '%ab.subsumes(%bc)', shared.options)).resolves.toEqual([true]);
    });

    it('is empty without a call for anything but one Coding or CodeableConcept on each side', async () => {
      const { calls, options } = provider({ 'a>b': 'subsumes' });
      for (const expression of [
        "'a'.subsumes(%b)",
        "%a.subsumes('b')",
        '%a.subsumes(%a | %b)',
        '(%a | %b).subsumes(%b)',
        '{}.subsumes(%b)',
        '%a.subsumes({})',
        '%none.subsumes(%b)',
        '%text.subsumes(%b)',
        '%a.subsumedBy(%none)',
      ]) {
        await expect(run(null, expression, options)).resolves.toEqual([]);
      }
      expect(calls).toEqual([]);
    });

    it('works on typed codings with a model', async () => {
      const { calls, options } = provider({ '8480-6>271649006': 'subsumes' });
      await expect(
        run(observation, 'Observation.code.coding[0].subsumes(Observation.code.coding[1])', {
          ...options,
          model: stubModel,
        }),
      ).resolves.toEqual([true]);
      await expect(
        run(observation, 'Observation.code.subsumedBy(Observation.code.coding[1])', {
          ...options,
          model: stubModel,
        }),
      ).resolves.toEqual([true]);
      expect(calls).toEqual(['8480-6>271649006', '8480-6>271649006']);
    });
  },
);

describe.each(MODES)('conformsTo(structure) with a conformsTo hook, %s', (_label, run, isAsync) => {
  const PROFILE = 'http://hl7.org/fhir/StructureDefinition/Patient';

  function hook(answer: (value: unknown, profile: string) => boolean | undefined): {
    readonly calls: [unknown, string][];
    readonly hooks: EvaluationHooks;
    readonly options: CompileOptions & EvaluateOptions;
  } {
    const calls: [unknown, string][] = [];
    const hooks = hooksFor(
      {
        conformsTo: (value, profile) => {
          calls.push([value, profile]);
          return answer(value, profile);
        },
      },
      isAsync,
    );
    return { calls, hooks, options: { model: stubModel, hooks } };
  }

  it('passes the JSON of the single input item and the profile URL', async () => {
    const { calls, options } = hook(() => true);
    await expect(run(patient, `conformsTo('${PROFILE}')`, options)).resolves.toEqual([true]);
    await expect(run(patient, `Patient.name.conformsTo('${PROFILE}')`, options)).resolves.toEqual([
      true,
    ]);
    await expect(run(null, `'x'.conformsTo('${PROFILE}')`, options)).resolves.toEqual([true]);
    expect(calls.map(([, profile]) => profile)).toEqual([PROFILE, PROFILE, PROFILE]);
    expect(calls[0]?.[0]).toBe(patient);
    expect(calls[1]?.[0]).toBe(patient.name[0]);
    expect(calls[2]?.[0]).toBe('x');
  });

  it('gives what the hook answers', async () => {
    await expect(
      run(patient, `conformsTo('${PROFILE}')`, hook(() => false).options),
    ).resolves.toEqual([false]);
    await expect(
      run(patient, `conformsTo('${PROFILE}')`, hook(() => undefined).options),
    ).resolves.toEqual([]);
  });

  it('is empty without a call for empty or several items and an empty structure', async () => {
    const { calls, options } = hook(() => true);
    await expect(
      run(patient, `Patient.missing.conformsTo('${PROFILE}')`, options),
    ).resolves.toEqual([]);
    await expect(
      run(patient, `Patient.extension.conformsTo('${PROFILE}')`, options),
    ).resolves.toEqual([]);
    await expect(run(patient, "conformsTo('')", options)).resolves.toEqual([]);
    await expect(run(patient, 'conformsTo({})', options)).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });

  // docs/spec-notes.md#hook-backed-functions-errors-and-empty-results: the hook throws for a
  // profile it cannot resolve, as the R4 text and the suites expect (testConformsTo3).
  it('raises the error the hook throws, with the span of the call', async () => {
    const { options } = hook((_value, profile) => {
      if (profile === 'http://trash') {
        throw new FhirPathEvaluationError(
          'eval/invalid-argument',
          'The profile cannot be resolved',
        );
      }
      return true;
    });
    const expression = "true and conformsTo('http://trash')";
    await expect(run(patient, expression, options)).rejects.toMatchObject({
      code: 'eval/invalid-argument',
      span: { start: 9, end: expression.length },
    });
    const failure = new RangeError('validator down');
    const failing = hook(() => {
      throw failure;
    });
    await expect(run(patient, `conformsTo('${PROFILE}')`, failing.options)).rejects.toBe(failure);
  });
});

describe.each(MODES)('htmlChecks() with an htmlChecks hook, %s', (_label, run, isAsync) => {
  const div = '<div xmlns="http://www.w3.org/1999/xhtml"><p>Peter</p></div>';
  const narrated = { ...patient, text: { status: 'generated', div } };

  function hook(answer: boolean | undefined): {
    readonly calls: [string, 'xhtml' | 'string'][];
    readonly hooks: EvaluationHooks;
    readonly options: CompileOptions & EvaluateOptions;
  } {
    const calls: [string, 'xhtml' | 'string'][] = [];
    const hooks = hooksFor(
      {
        htmlChecks: (html, context) => {
          calls.push([html, context.kind]);
          return answer;
        },
      },
      isAsync,
    );
    return { calls, hooks, options: { model: stubModel, hooks } };
  }

  it('passes xhtml as the element itself and any other string as content', async () => {
    const { calls, options } = hook(true);
    await expect(run(narrated, 'Patient.text.`div`.htmlChecks()', options)).resolves.toEqual([
      true,
    ]);
    await expect(run(narrated, 'Patient.name.family.htmlChecks()', options)).resolves.toEqual([
      true,
    ]);
    await expect(run(narrated, 'Patient.gender.htmlChecks()', options)).resolves.toEqual([true]);
    await expect(run(null, "'<b>x</b>'.htmlChecks()", options)).resolves.toEqual([true]);
    expect(calls).toEqual([
      [div, 'xhtml'],
      ['Chalmers', 'string'],
      ['male', 'string'],
      ['<b>x</b>', 'string'],
    ]);
  });

  it('reads text.div as a string without a model', async () => {
    const { calls, hooks } = hook(true);
    await expect(run(narrated, 'Patient.text.`div`.htmlChecks()', { hooks })).resolves.toEqual([
      true,
    ]);
    expect(calls).toEqual([[div, 'string']]);
  });

  it('gives false and empty as the hook answers', async () => {
    await expect(
      run(narrated, 'Patient.text.`div`.htmlChecks()', hook(false).options),
    ).resolves.toEqual([false]);
    await expect(
      run(narrated, 'Patient.text.`div`.htmlChecks()', hook(undefined).options),
    ).resolves.toEqual([]);
  });

  it('is empty without a call for input that is not one string', async () => {
    const { calls, options } = hook(true);
    for (const expression of [
      'Patient.active.htmlChecks()',
      'Patient.name.htmlChecks()',
      'Patient.birthDate.htmlChecks()',
      'Patient.missing.htmlChecks()',
      'Patient.extension.htmlChecks()',
      '(1).htmlChecks()',
    ]) {
      await expect(run(narrated, expression, options)).resolves.toEqual([]);
    }
    expect(calls).toEqual([]);
  });
});
