import { describe, expect, it } from 'vitest';
import type { ErrorKind, EvaluationOptions, EvaluatorAdapter } from './adapter.ts';
import { classifyTest } from './classify.ts';
import { type InputReader, loadSuite, NOT_CONVERTED } from './fixtures.ts';
import { createRunner, evaluationOptions } from './run-suite.ts';
import { stubAdapter } from './stub-adapter.ts';
import { SUITE_IDS, type SuiteTest } from './suite.ts';
import { makeTest } from './test-helpers.ts';

/** An engine error with the shape the fake adapter classifies. */
class EngineError extends Error {
  readonly kind: ErrorKind;
  constructor(kind: ErrorKind) {
    super(`${kind} problem`);
    this.kind = kind;
  }
}

const ERROR_KINDS: readonly ErrorKind[] = ['syntax', 'semantic', 'execution', 'not-implemented'];

/**
 * A fake adapter: `evaluate` returns the integers listed in the expression (`1,2`), throws an
 * engine error for `throw:<kind>`, and a `TypeError` for `throw:crash`.
 */
function fakeAdapter(overrides: Partial<EvaluatorAdapter> = {}): EvaluatorAdapter {
  return {
    name: 'fake',
    evaluate(_input, expression) {
      const kind = ERROR_KINDS.find((k) => expression === `throw:${k}`);
      if (kind !== undefined) {
        throw new EngineError(kind);
      }
      if (expression === 'throw:crash') {
        throw new TypeError('boom');
      }
      return expression === '' ? [] : expression.split(',').map(Number);
    },
    describeValue: (value) => ({ type: 'System.Integer', value: String(value) }),
    classifyError: (error) =>
      error instanceof EngineError
        ? { kind: error.kind, code: `${error.kind}/code`, message: error.message }
        : { kind: 'other', code: undefined, message: String(error) },
    ...overrides,
  };
}

const noInput: InputReader = () => ({ kind: 'skip', reason: 'no inputs in this test' });

async function run(test: SuiteTest, adapter = fakeAdapter(), readInput = noInput) {
  return createRunner({ adapter, readInput, exceptions: [] }).runTest('r5', test);
}

describe('runTest outputs', () => {
  it('passes when the result matches the outputs', async () => {
    const test = makeTest({
      expression: '1,2',
      outputs: [
        { type: 'integer', text: '1' },
        { type: 'integer', text: '2' },
      ],
    });
    expect(await run(test)).toMatchObject({
      status: 'pass',
      failure: undefined,
      detectedLate: false,
    });
  });

  it('passes an empty result when there are no outputs', async () => {
    expect((await run(makeTest({ expression: '' }))).status).toBe('pass');
  });

  it('fails with a diff when the result differs', async () => {
    const test = makeTest({ expression: '2', outputs: [{ type: 'integer', text: '1' }] });
    expect((await run(test)).failure).toEqual({
      kind: 'wrong-output',
      message: 'expected [integer 1], got [integer 2]',
      expected: ['integer 1'],
      actual: ['integer 2'],
    });
  });

  it('compares unordered when ordered="false"', async () => {
    const outputs = [
      { type: 'integer', text: '1' },
      { type: 'integer', text: '2' },
    ] as const;
    expect((await run(makeTest({ expression: '2,1', outputs }))).status).toBe('fail');
    expect((await run(makeTest({ expression: '2,1', outputs, ordered: false }))).status).toBe(
      'pass',
    );
  });

  it('converts the result to a Boolean when predicate="true"', async () => {
    const adapter = fakeAdapter({
      describeValue: () => ({ type: 'FHIR.date', value: '1974-12-25' }),
    });
    const test = makeTest({
      expression: '1',
      predicate: true,
      outputs: [{ type: 'boolean', text: 'true' }],
    });
    expect((await run(test, adapter)).status).toBe('pass');
  });

  it('awaits async adapters', async () => {
    const adapter = fakeAdapter({ evaluate: async () => [7] });
    const test = makeTest({ outputs: [{ type: 'integer', text: '7' }] });
    expect((await run(test, adapter)).status).toBe('pass');
  });
});

describe('runTest errors', () => {
  // https://hl7.org/fhirpath/N1/#type-safety-and-strict-evaluation
  it.each([
    ['syntax', 'syntax', 'pass', false],
    ['execution', 'execution', 'pass', false],
    ['semantic', 'semantic', 'pass', false],
    ['semantic', 'execution', 'pass', true],
    ['true', 'syntax', 'pass', false],
    ['true', 'execution', 'pass', false],
    ['syntax', 'semantic', 'fail', false],
    ['execution', 'semantic', 'fail', false],
    ['true', 'crash', 'fail', false],
  ] as const)('invalid="%s" with a %s error → %s', async (invalid, thrown, status, late) => {
    const result = await run(makeTest({ invalid, expression: `throw:${thrown}` }));
    expect(result).toMatchObject({ status, detectedLate: late });
    if (status === 'fail') {
      expect(result.failure?.kind).toBe('wrong-error');
    }
  });

  it('fails a test that expects an error but gets a result', async () => {
    expect((await run(makeTest({ invalid: 'syntax', expression: '1' }))).failure).toEqual({
      kind: 'missing-error',
      message: 'expected a syntax error, got a result with 1 item(s)',
    });
  });

  it('fails a test that expects a result but gets an error, with the error code', async () => {
    expect((await run(makeTest({ expression: 'throw:execution' }))).failure).toEqual({
      kind: 'unexpected-error',
      message: 'unexpected execution error [execution/code]: execution problem',
    });
  });

  it('fails "not implemented" whatever the test expects', async () => {
    for (const invalid of [undefined, 'true'] as const) {
      const result = await run(makeTest({ invalid, expression: 'throw:not-implemented' }));
      expect(result.failure?.kind).toBe('not-implemented');
    }
  });

  it('reports adapter faults as runner errors instead of crashing', async () => {
    // A broken adapter that ignores the type contract and returns a string.
    const notArray = fakeAdapter({ evaluate: () => JSON.parse('"x"') });
    expect((await run(makeTest(), notArray)).failure?.kind).toBe('runner-error');
    const badDescribe = fakeAdapter({
      describeValue: () => {
        throw new Error('nope');
      },
    });
    expect((await run(makeTest(), badDescribe)).failure).toEqual({
      kind: 'runner-error',
      message: 'describeValue failed: nope',
    });
    const badClassify = fakeAdapter({
      classifyError: () => {
        throw new Error('nope');
      },
    });
    const result = await run(
      makeTest({ invalid: 'true', expression: 'throw:syntax' }),
      badClassify,
    );
    expect(result.failure?.kind).toBe('wrong-error');
  });
});

describe('runTest inputs and skips', () => {
  const json: InputReader = (_, file) =>
    file.endsWith('.json')
      ? { kind: 'json', path: `/fixtures/${file}`, text: '{"resourceType":"Patient","n":1.50}' }
      : { kind: 'skip', reason: NOT_CONVERTED };

  it('passes the parsed input to the adapter', async () => {
    const seen: unknown[] = [];
    const adapter = fakeAdapter({
      evaluate: (input) => {
        seen.push(input);
        return [];
      },
    });
    await run(makeTest({ inputFile: 'a.json' }), adapter, json);
    expect(seen).toEqual([{ resourceType: 'Patient', n: 1.5 }]);
  });

  it("uses the adapter's parser, once per file", async () => {
    let parses = 0;
    const adapter = fakeAdapter({
      parseInput: (text) => {
        parses++;
        return { text };
      },
    });
    const runner = createRunner({ adapter, readInput: json, exceptions: [] });
    await runner.runTest('r5', makeTest({ inputFile: 'a.json' }));
    await runner.runTest('r5', makeTest({ inputFile: 'a.json' }));
    expect(parses).toBe(1);
  });

  it('fails tests whose input is not valid JSON', async () => {
    const broken: InputReader = () => ({ kind: 'json', path: '/x.json', text: '{' });
    const result = await run(makeTest({ inputFile: 'x.json' }), fakeAdapter(), broken);
    expect(result.failure?.kind).toBe('runner-error');
  });

  it('skips XML inputs that are not converted yet', async () => {
    expect(
      await run(makeTest({ inputFile: 'patient-example.xml' }), fakeAdapter(), json),
    ).toMatchObject({
      status: 'skip',
      skipReason: NOT_CONVERTED,
    });
  });

  it('skips unsupported tests with the reason', async () => {
    expect(await run(makeTest({ mode: 'cda' }))).toMatchObject({
      status: 'skip',
      skipReason: 'CDA logical model (mode="cda")',
    });
  });

  it('skips exceptions with a link to spec-notes', async () => {
    const runner = createRunner({
      adapter: fakeAdapter(),
      readInput: noInput,
      exceptions: [{ suites: ['r5'], tests: ['test1'], reason: 'wrong label', note: 'some-note' }],
    });
    expect(await runner.runTest('r5', makeTest({ expression: '' }))).toMatchObject({
      status: 'skip',
      skipReason: 'exception: wrong label (spec-notes#some-note)',
    });
    expect((await runner.runTest('r4', makeTest({ expression: '' }))).status).toBe('pass');
  });
});

describe('evaluationOptions', () => {
  it('maps the test attributes to adapter options', () => {
    const test = makeTest({
      name: 'ctx',
      inputFile: 'observation-example.xml',
      context: 'Observation.effective',
      contextTypes: ['Period', 'Timing'],
      mode: 'strict',
      checkOrderedFunctions: true,
      skipStaticCheck: true,
    });
    expect(evaluationOptions('r4', test)).toEqual<EvaluationOptions>({
      fhirVersion: 'r4',
      testId: 'ctx',
      inputFile: 'observation-example.xml',
      context: 'Observation.effective',
      contextTypes: ['Period', 'Timing'],
      mode: 'strict',
      strict: true,
      lenientChoiceSuffix: false,
      checkOrderedFunctions: true,
      skipStaticCheck: true,
    });
    // ADR-0012: lenient/polymorphics tests accept choice-type suffixes.
    const lenient = evaluationOptions('r5', makeTest({ mode: 'lenient/polymorphics' }));
    expect(lenient).toMatchObject({ strict: false, lenientChoiceSuffix: true });
  });
});

// T0022 acceptance: the runner runs end to end with the stub adapter; every test is run or
// skipped with a reason, JSON inputs run, and XML inputs are skipped until T0023.
describe.each(SUITE_IDS)('the vendored %s suite with the stub adapter', (id) => {
  it('runs or skips every test, and never crashes', async () => {
    const suite = loadSuite(id);
    const run = await createRunner({ adapter: stubAdapter }).runSuite(suite);
    expect(run.results.length).toBeGreaterThan(1000);
    for (const result of run.results) {
      const { test } = result;
      if (result.status === 'skip') {
        expect(result.skipReason, test.id).toMatch(/\S/);
      } else {
        expect(result.status, test.id).toBe('fail');
        expect(result.failure?.kind, test.id).toBe('not-implemented');
      }
      const unsupported = classifyTest(test).phase === 'unsupported';
      if (!unsupported && test.inputFile?.endsWith('.xml')) {
        expect(result.skipReason, test.id).toBe(NOT_CONVERTED);
      }
      if (!unsupported && (test.inputFile === undefined || test.inputFile.endsWith('.json'))) {
        expect(result.status, test.id).toBe('fail');
      }
    }
  });
});
