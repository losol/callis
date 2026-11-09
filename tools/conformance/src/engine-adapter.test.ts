import { describe, expect, it, vi } from 'vitest';
import { compile } from '../../../packages/core/src/api/compile.ts';
import { JsonNumber } from '../../../packages/core/src/model/lossless-json.ts';
import { ModelNode } from '../../../packages/core/src/model/model-node.ts';
import type { Item } from '../../../packages/core/src/runtime/collection.ts';
import { equals } from '../../../packages/core/src/runtime/equality.ts';
import { parseTemporalLiteral } from '../../../packages/core/src/values/datetime/parse.ts';
import { Decimal } from '../../../packages/core/src/values/decimal/decimal.ts';
import { Quantity } from '../../../packages/core/src/values/quantity/quantity.ts';
import {
  minimalUnitSystem,
  type UnitSystem,
} from '../../../packages/core/src/values/quantity/unit-system.ts';
import { r4 } from '../../../packages/fhir-r4/src/index.ts';
import { r5 } from '../../../packages/fhir-r5/src/index.ts';
import { ucum } from '../../../packages/ucum/src/index.ts';
import type { EvaluationOptions } from './adapter.ts';
import { engineAdapter } from './engine-adapter.ts';

// Records the options of every compile(), to check what the adapter passes.
vi.mock('../../../packages/core/src/api/compile.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../packages/core/src/api/compile.ts')>();
  return { ...actual, compile: vi.fn(actual.compile) };
});

const options: EvaluationOptions = {
  fhirVersion: 'r4',
  testId: 'test',
  inputFile: undefined,
  context: undefined,
  contextTypes: [],
  mode: undefined,
  strict: false,
  lenientChoiceSuffix: false,
  skipStaticCheck: false,
};

const patient = { resourceType: 'Patient', name: [{ given: ['a', 'b'] }, { given: ['c'] }] };

async function evaluate(expression: string, extra: Partial<EvaluationOptions> = {}) {
  return engineAdapter.evaluate(patient, expression, { ...options, ...extra });
}

async function classify(expression: string, extra: Partial<EvaluationOptions> = {}) {
  try {
    await evaluate(expression, extra);
  } catch (error) {
    return engineAdapter.classifyError(error);
  }
  return undefined;
}

// tools/conformance/README.md#plugging-in-an-evaluator
describe('engineAdapter.evaluate', () => {
  it('evaluates with the internal API and the FHIR model, and gives typed items', async () => {
    const result = await evaluate('name.given');
    expect(result.map((item) => engineAdapter.describeValue(item))).toEqual([
      { type: 'FHIR.string', value: 'a' },
      { type: 'FHIR.string', value: 'b' },
      { type: 'FHIR.string', value: 'c' },
    ]);
  });

  it('evaluates the implemented filter instead of classifying it as missing', async () => {
    const result = await evaluate("name.where(given = 'c').given");
    expect(result.map((item) => engineAdapter.describeValue(item))).toEqual([
      { type: 'FHIR.string', value: 'c' },
    ]);
  });

  // docs/tasks/T0018-model-aware-evaluation.md: the model of the suite's FHIR version.
  it('uses the R4 or R5 model by the suite, with the choice suffix only in lenient mode', async () => {
    const observation = {
      resourceType: 'Observation',
      valueQuantity: {
        value: 185,
        unit: 'lbs',
        system: 'http://unitsofmeasure.org',
        code: '[lb_av]',
      },
    };
    const run = (expression: string, extra: Partial<EvaluationOptions> = {}) =>
      engineAdapter.evaluate(observation, expression, { ...options, ...extra });
    expect(await run('Observation.value.unit')).toEqual([
      expect.objectContaining({ value: 'lbs' }),
    ]);
    expect(await run('Observation.valueQuantity.unit')).toEqual([]);
    expect(await run('Observation.valueQuantity.unit', { lenientChoiceSuffix: true })).toEqual([
      expect.objectContaining({ value: 'lbs' }),
    ]);
    expect(await run('Observation.value is Quantity', { fhirVersion: 'r5' })).toEqual([true]);
    vi.mocked(compile).mockClear();
    await run('1', { fhirVersion: 'r5' });
    await run('1', { fhirVersion: 'r4' });
    expect(
      vi.mocked(compile).mock.calls.map(([, compileOptions]) => compileOptions?.model),
    ).toEqual([r5, r4]);
  });

  it('parses inputs losslessly and evaluates them with their precision', async () => {
    const input = engineAdapter.parseInput?.(
      '{"resourceType": "Observation", "valueQuantity": {"value": 1.50}}',
    );
    expect(input).toMatchObject({ valueQuantity: { value: new JsonNumber('1.50') } });
    const result = await engineAdapter.evaluate(input, 'Observation.value.value', options);
    expect(result.map((item) => engineAdapter.describeValue(item))).toEqual([
      { type: 'FHIR.decimal', value: '1.50' },
    ]);
  });

  it('evaluates existence and count through the implemented default registry', async () => {
    expect(await evaluate("name.exists(given = 'c')")).toEqual([true]);
    expect(await evaluate("name.where(given = 'c').count()")).toEqual([1]);
  });

  // https://hl7.org/fhirpath/N1/#single-collection
  // https://hl7.org/fhirpath/N1/#first-collection
  it('evaluates first and single without hiding cardinality errors as missing features', async () => {
    const result = await evaluate('name.first().single().given');
    expect(result.map((item) => engineAdapter.describeValue(item))).toEqual([
      { type: 'FHIR.string', value: 'a' },
      { type: 'FHIR.string', value: 'b' },
    ]);
    expect(await classify('name.single()')).toMatchObject({
      kind: 'execution',
      code: 'eval/singleton-expected',
    });
  });

  it('evaluates the expression on the single node the context selects', async () => {
    const result = await evaluate('given', { context: 'name[1]' });
    expect(result.map((item) => engineAdapter.describeValue(item))).toEqual([
      { type: 'FHIR.string', value: 'c' },
    ]);
  });

  // tools/conformance/README.md: %resource and %rootResource stay the whole input.
  it('keeps the whole input as %resource and %rootResource under a context', async () => {
    expect(await evaluate('%resource = %rootResource', { context: 'name[1]' })).toEqual([true]);
    expect(await evaluate('%resource.name.count()', { context: 'name[1]' })).toEqual([2]);
    expect(await evaluate('%context.given.count()', { context: 'name[1]' })).toEqual([1]);
  });

  it('fails as a runner problem when the context does not select one node', async () => {
    expect(await classify('given', { context: 'name' })).toMatchObject({ kind: 'other' });
    expect(await classify('given', { context: 'missing' })).toMatchObject({ kind: 'other' });
  });
});

// The runner always uses @callis/ucum (docs/tasks/T0006-quantity.md#design-notes), so the
// quantity groups can pass once T0010 adds the operators (docs/tasks/T0007-ucum.md). Until then no
// expression compares quantities, so these tests check the unit system both compile() calls get.
describe('engineAdapter units', () => {
  it('compiles the context and the expression with the UCUM unit system', async () => {
    vi.mocked(compile).mockClear();
    await evaluate("1 'mg/dL'", { context: 'name[1]' });
    const calls = vi.mocked(compile).mock.calls;
    expect(calls.map(([expression]) => expression)).toEqual(['name[1]', "1 'mg/dL'"]);
    for (const [, compileOptions] of calls) {
      expect(compileOptions?.units).toBe(ucum);
    }
  });

  it('relates UCUM units of the quantities it returns, with one copy of core', async () => {
    const kilogram = (await evaluate("1 'kg'")) as readonly Item[];
    const gram = (await evaluate("1000 'g'")) as readonly Item[];
    const units = vi.mocked(compile).mock.lastCall?.[1]?.units;
    const context = (unitSystem: UnitSystem | undefined) => ({
      model: undefined,
      units: unitSystem ?? minimalUnitSystem,
      timezoneOffset: 0,
    });
    // https://hl7.org/fhirpath/N1/#equals: quantities of the same dimension are converted.
    expect(equals(kilogram, gram, context(units))).toBe(true);
    expect(equals(kilogram, gram, context(minimalUnitSystem))).toBeUndefined();
    // UCUM resolves @callis/core to the engine's source, so its values are the engine's classes.
    expect(ucum.convert(Decimal.ONE, 'kg', 'g')).toBeInstanceOf(Decimal);
  });
});

describe('engineAdapter.classifyError', () => {
  it.each<[string, string, string | undefined]>([
    ['name.', 'syntax', 'syntax/unexpected-token'],
    ['name.noSuchFunction()', 'semantic', 'semantic/unknown-function'],
    ['true.not(1)', 'semantic', 'semantic/wrong-arity'],
    ['%undefined', 'execution', 'eval/undefined-variable'],
    ['name.given is Patient', 'execution', 'eval/singleton-expected'],
    ["name.given.where($this | 'x')", 'execution', 'eval/singleton-expected'],
  ])('classifies %s as %s', async (expression, kind, code) => {
    expect(await classify(expression)).toMatchObject({ kind, code });
  });

  // Honest conformance: a missing feature must never pass a test that expects an error.
  it.each([
    'name.empty()',
    'name.where(given.empty())',
    "'a'.matchesFull('a')",
    'name.given.aggregate($total)',
    '%terminologies',
    '%server',
  ])('reports %s, which uses a feature of a later task, as not implemented', async (expression) => {
    expect(await classify(expression)).toMatchObject({ kind: 'not-implemented' });
  });

  // docs/tasks/T0021-hooks-async.md#acceptance-criteria: the fake hooks of fake-hooks.ts.
  it('answers conformsTo() for the base profiles of the suite model', async () => {
    const base = 'http://hl7.org/fhir/StructureDefinition/';
    const shown = (items: readonly unknown[]) =>
      items.map((item) => engineAdapter.describeValue(item));
    expect(shown(await evaluate(`conformsTo('${base}Patient')`))).toEqual([
      { type: 'System.Boolean', value: 'true' },
    ]);
    expect(shown(await evaluate(`conformsTo('${base}Person')`, { fhirVersion: 'r5' }))).toEqual([
      { type: 'System.Boolean', value: 'false' },
    ]);
  });

  it('reports a profile that cannot be resolved as an execution error (testConformsTo3)', async () => {
    expect(await classify("conformsTo('http://trash')")).toMatchObject({
      kind: 'execution',
      code: 'eval/invalid-argument',
    });
  });

  it('checks strings with htmlChecks(), and leaves other values empty', async () => {
    const shown = (items: readonly unknown[]) =>
      items.map((item) => engineAdapter.describeValue(item));
    expect(shown(await evaluate("'<b>ok</b>'.htmlChecks()"))).toEqual([
      { type: 'System.Boolean', value: 'true' },
    ]);
    expect(shown(await evaluate("'<button>no</button>'.htmlChecks()"))).toEqual([
      { type: 'System.Boolean', value: 'false' },
    ]);
    expect(await evaluate('(5).htmlChecks()')).toEqual([]);
  });

  it('leaves memberOf() empty: no suite test needs a terminology provider', async () => {
    expect(await evaluate('name.given.memberOf(%`vs-administrative-gender`)')).toEqual([]);
  });

  it.each(['(%terminologies)', '%`\\u0074erminologies`', '(%`factory`).id'])(
    'recognizes the planned variable in %s however it is written',
    async (expression) => {
      expect(await classify(expression)).toMatchObject({ kind: 'not-implemented' });
    },
  );

  it.each(['constructor()', 'hasOwnProperty()', 'valueOf()'])(
    'keeps %s, which no task adds, a semantic error',
    async (expression) => {
      expect(await classify(expression)).toMatchObject({
        kind: 'semantic',
        code: 'semantic/unknown-function',
      });
    },
  );

  it('handles an expression too deep to compile', async () => {
    expect(await classify(`a${'.a'.repeat(50_000)}`)).toMatchObject({
      kind: 'syntax',
      code: 'syntax/nesting-limit',
    });
  });

  it('reports the context expression as not implemented when it uses such a feature', async () => {
    expect(await classify('given', { context: 'name.given.aggregate($total)' })).toMatchObject({
      kind: 'not-implemented',
    });
  });

  it('classifies anything else as other', () => {
    expect(engineAdapter.classifyError(new TypeError('bug'))).toMatchObject({ kind: 'other' });
    expect(engineAdapter.classifyError('text')).toMatchObject({ kind: 'other', message: 'text' });
  });
});

describe('engineAdapter.describeValue', () => {
  it.each<[unknown, object]>([
    [true, { type: 'System.Boolean', value: 'true' }],
    ['a', { type: 'System.String', value: 'a' }],
    [5, { type: 'System.Integer', value: '5' }],
    [Decimal.parse('1.50'), { type: 'System.Decimal', value: '1.50' }],
    [parseTemporalLiteral('@2014-01-01'), { type: 'System.Date', value: '2014-01-01' }],
    [
      parseTemporalLiteral('@2014-01-01T10:00'),
      { type: 'System.DateTime', value: '2014-01-01T10:00' },
    ],
    [parseTemporalLiteral('@T10:30:00.000'), { type: 'System.Time', value: '10:30:00.000' }],
    [new Quantity(Decimal.ONE, 'cm'), { type: 'System.Quantity', value: '1', unit: 'cm' }],
  ])('describes %s', (value, expected) => {
    expect(engineAdapter.describeValue(value)).toEqual(expected);
  });

  it('describes untyped input nodes by the System type of their JSON value', () => {
    expect(engineAdapter.describeValue(new ModelNode({ value: 1.5, name: 'x' }))).toEqual({
      type: 'System.Decimal',
      value: '1.5',
    });
    expect(engineAdapter.describeValue(new ModelNode({ value: { a: 1 }, name: 'x' }))).toEqual({
      type: 'Object',
    });
  });

  // tools/conformance/README.md: FHIR types are described by their own name.
  it('describes typed nodes by their model type and System value', async () => {
    const input = {
      resourceType: 'Patient',
      birthDate: '1974-12-25',
      name: [{ given: [null], _given: [{ id: 'g' }] }],
      extension: [
        {
          url: 'http://example.org/age',
          valueAge: { value: 41, system: 'http://unitsofmeasure.org', code: 'a' },
        },
      ],
    };
    const describe = async (expression: string) =>
      (await engineAdapter.evaluate(input, expression, options)).map((item) =>
        engineAdapter.describeValue(item),
      );
    expect(await describe('birthDate')).toEqual([{ type: 'FHIR.date', value: '1974-12-25' }]);
    expect(await describe('name')).toEqual([{ type: 'FHIR.HumanName' }]);
    expect(await describe('name.given')).toEqual([{ type: 'FHIR.string' }]);
    expect(await describe('extension.value')).toEqual([
      { type: 'FHIR.Age', value: '41', unit: 'year' },
    ]);
  });
});
