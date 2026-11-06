import { describe, expect, it } from 'vitest';
import { ModelNode } from '../../../packages/core/src/model/model-node.ts';
import { parseTemporalLiteral } from '../../../packages/core/src/values/datetime/parse.ts';
import { Decimal } from '../../../packages/core/src/values/decimal/decimal.ts';
import { Quantity } from '../../../packages/core/src/values/quantity/quantity.ts';
import type { EvaluationOptions } from './adapter.ts';
import { engineAdapter } from './engine-adapter.ts';

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
  it('evaluates with the internal API and gives typed items', async () => {
    const result = await evaluate('name.given');
    expect(result.map((item) => engineAdapter.describeValue(item))).toEqual([
      { type: 'System.String', value: 'a' },
      { type: 'System.String', value: 'b' },
      { type: 'System.String', value: 'c' },
    ]);
  });

  it('evaluates the expression on the single node the context selects', async () => {
    const result = await evaluate('given', { context: 'name[1]' });
    expect(result.map((item) => engineAdapter.describeValue(item))).toEqual([
      { type: 'System.String', value: 'c' },
    ]);
  });

  it('fails as a runner problem when the context does not select one node', async () => {
    expect(await classify('given', { context: 'name' })).toMatchObject({ kind: 'other' });
    expect(await classify('given', { context: 'missing' })).toMatchObject({ kind: 'other' });
  });
});

describe('engineAdapter.classifyError', () => {
  it.each<[string, string, string | undefined]>([
    ['name.', 'syntax', 'syntax/unexpected-token'],
    ['name.noSuchFunction()', 'semantic', 'semantic/unknown-function'],
    ['true.not(1)', 'semantic', 'semantic/wrong-arity'],
    ['%undefined', 'execution', 'eval/undefined-variable'],
    ['name.given is Patient', 'execution', 'eval/singleton-expected'],
  ])('classifies %s as %s', async (expression, kind, code) => {
    expect(await classify(expression)).toMatchObject({ kind, code });
  });

  // Honest conformance: a missing feature must never pass a test that expects an error.
  it.each([
    'name.exists()',
    'name.where(given.empty())',
    "'a'.matches('a')",
    'name.given.aggregate($total)',
    '%resource',
    '%`vs-administrative-gender`',
    '%terminologies',
  ])('reports %s, which uses a feature of a later task, as not implemented', async (expression) => {
    expect(await classify(expression)).toMatchObject({ kind: 'not-implemented' });
  });

  it('reports the context expression as not implemented when it uses such a feature', async () => {
    expect(await classify('given', { context: 'name.first()' })).toMatchObject({
      kind: 'not-implemented',
    });
  });

  it('reports operators of a later task as not implemented when they are evaluated', async () => {
    expect(await classify('1 = 1')).toMatchObject({
      kind: 'not-implemented',
      code: 'eval/not-implemented',
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
});
