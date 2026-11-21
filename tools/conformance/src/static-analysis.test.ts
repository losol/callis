/**
 * Static analysis over the HL7 suite ([T0024](../../../docs/tasks/T0024-static-analysis.md)).
 * Without a model, no expression the suite expects to evaluate is rejected by analysis that cannot
 * see the input's types. With the suite's models and inputs, the analysis is sound: an expression
 * that evaluates on its input gets no error from lenient analysis. The suite's `invalid="semantic"`
 * tests are the exception the suite asks for: the Java runner rejects them statically although
 * some of them would evaluate, so they are left out. And strict mode is safe: an expression it
 * accepts does not fail at evaluation for want of a single item. The analysis with the suite's
 * models and input types is measured by the conformance run itself. Evaluation types an input that
 * does not name its type from `inputType` ([#224](https://github.com/losol/callis/issues/224)), so
 * the same holds for such inputs: a resource without its `resourceType` evaluates as the resource,
 * and a data type on its own as the same element inside a resource.
 */
import { describe, expect, it } from 'vitest';
import {
  analyze,
  type CompileOptions,
  compileUnchecked,
} from '../../../packages/core/src/api/compile.ts';
import { FhirPathEvaluationError } from '../../../packages/core/src/errors/fhirpath-error.ts';
import { r4 } from '../../../packages/fhir-r4/src/index.ts';
import { r5 } from '../../../packages/fhir-r5/src/index.ts';
import { r6 } from '../../../packages/fhir-r6/src/index.ts';
import { classifyTest } from './classify.ts';
import { engineAdapter } from './engine-adapter.ts';
import { loadSuite } from './fixtures.ts';
import { allTests, SUITE_IDS } from './suite.ts';
import {
  evaluateUnchecked,
  inputReader,
  prepareTest,
  type UncheckedOutcome,
} from './suite-evaluation.ts';

describe.each(SUITE_IDS)('model-less analysis of the %s suite', (id) => {
  const tests = allTests(loadSuite(id)).filter(
    (test) => test.invalid === undefined && classifyTest(test).phase === 'phase1',
  );

  it('rejects no phase-1 expression that the suite expects to evaluate', () => {
    const rejected: string[] = [];
    for (const test of tests) {
      for (const diagnostic of analyze(test.expression).diagnostics) {
        // A function a later task adds is unknown to the registry, not a false error, and what
        // does not parse (htmlTest01, docs/spec-notes.md#reserved-div-in-an-html-fixture) is
        // the parser's.
        if (
          diagnostic.severity === 'error' &&
          diagnostic.code !== 'semantic/unknown-function' &&
          !diagnostic.code.startsWith('syntax/')
        ) {
          rejected.push(`${test.id}: ${diagnostic.code} ${diagnostic.message}`);
        }
      }
    }
    expect(rejected).toEqual([]);
    expect(tests.length).toBeGreaterThan(800);
  });
});

describe.each(SUITE_IDS)('analysis of the %s suite with its model and inputs', (id) => {
  const read = inputReader(id);
  const tests = allTests(loadSuite(id)).filter((test) => test.invalid !== 'semantic');

  it('reports no error for an expression that evaluates on its input', async () => {
    const unsound: string[] = [];
    let evaluated = 0;
    for (const test of tests) {
      const prepared = await prepareTest(id, test, read(test));
      if (prepared === undefined || !(await evaluateUnchecked(test, prepared)).ok) {
        continue;
      }
      evaluated++;
      const error = analyze(test.expression, prepared.options).diagnostics.find(
        (diagnostic) => diagnostic.severity === 'error',
      );
      if (error !== undefined) {
        unsound.push(`${test.id}: ${error.code} ${error.message}`);
      }
    }
    expect(unsound).toEqual([]);
    expect(evaluated).toBeGreaterThan(700);
  }, 120_000);
});

describe.each(SUITE_IDS)('strict analysis of the %s suite with its model and inputs', (id) => {
  const read = inputReader(id);
  // single() raises the singleton error by its contract when its input has more than one item
  // ([N1 §5.2.6](https://hl7.org/fhirpath/N1/#single-collection)): that error is the result the
  // expression asks for, not an unsafe use, so those tests are left out.
  const tests = allTests(loadSuite(id)).filter((test) => !/\bsingle\s*\(/.test(test.expression));

  // N1 §11: what strict mode accepts must not fail at evaluation for the reason strict mode
  // exists, an operation that needs one item and gets more.
  it('accepts no expression whose evaluation needs a singleton it does not get', async () => {
    const unsafe: string[] = [];
    let accepted = 0;
    for (const test of tests) {
      const prepared = await prepareTest(id, test, read(test));
      if (prepared === undefined) {
        continue;
      }
      const strict = { ...prepared.options, strict: true };
      if (analyze(test.expression, strict).diagnostics.some((d) => d.severity === 'error')) {
        continue;
      }
      accepted++;
      const outcome = await evaluateUnchecked(test, prepared);
      if (
        !outcome.ok &&
        outcome.error instanceof FhirPathEvaluationError &&
        outcome.error.code === 'eval/singleton-expected'
      ) {
        unsafe.push(`${test.id}: ${outcome.error.message}`);
      }
    }
    expect(unsafe).toEqual([]);
    expect(accepted).toBeGreaterThan(700);
  }, 120_000);
});

/** An outcome as the comparison of the suite sees it: the described items, or the error. */
function describeOutcome(outcome: UncheckedOutcome): unknown {
  if (outcome.ok) {
    return outcome.items.map((item) => engineAdapter.describeValue(item));
  }
  const { kind, code } = engineAdapter.classifyError(outcome.error);
  return { kind, code };
}

/**
 * The tests whose result depends on the input naming its type in the data, which inputType does
 * not change, with the reason ([spec notes](../../../docs/spec-notes.md#the-input-type-at-evaluation),
 * [#233](https://github.com/losol/callis/issues/233)).
 */
const NAMES_ITS_TYPE: Readonly<Record<string, string>> = {
  testConformsTo1: 'the conformsTo hook gets the JSON, which no longer says it is a Patient',
  testMultipleResolve:
    'resolve() finds the container of a contained resource by its own resourceType',
};

// https://github.com/losol/callis/issues/224: evaluation types an input that does not name its
// type from inputType, as analysis does. A resource with its resourceType removed and its type
// given as inputType must evaluate as the resource itself, so the soundness above carries over.
describe.each(SUITE_IDS)('the %s suite on resources typed by inputType', (id) => {
  const read = inputReader(id);
  const tests = allTests(loadSuite(id)).filter(
    (test) => test.context === undefined && !Object.hasOwn(NAMES_ITS_TYPE, test.name),
  );

  it('evaluates as with the resourceType', async () => {
    const different: string[] = [];
    let compared = 0;
    for (const test of tests) {
      const prepared = await prepareTest(id, test, read(test));
      const focus = prepared?.focus;
      if (
        prepared === undefined ||
        typeof prepared.options.inputType !== 'string' ||
        typeof focus !== 'object' ||
        focus === null ||
        !Object.hasOwn(focus, 'resourceType')
      ) {
        continue;
      }
      const { resourceType: _, ...bare } = focus as Readonly<Record<string, unknown>>;
      const typed = describeOutcome(await evaluateUnchecked(test, prepared));
      const untyped = describeOutcome(await evaluateUnchecked(test, { ...prepared, focus: bare }));
      compared++;
      if (JSON.stringify(untyped) !== JSON.stringify(typed)) {
        different.push(`${test.id}: ${JSON.stringify(untyped)} ≠ ${JSON.stringify(typed)}`);
      }
    }
    expect(different).toEqual([]);
    expect(compared).toBeGreaterThan(600);
  }, 120_000);
});

describe.each([
  ['R4', r4],
  ['R5', r5],
  ['R6', r6],
] as const)('analysis and evaluation of a data type typed by inputType with %s', (_, model) => {
  const extension = [{ url: 'https://example.org/precision', valueString: 'day' }];
  const period = { start: '2020-01-01', _start: { extension }, end: '2020-02-01' };
  const name = { use: 'official', given: ['Peter', 'James'], _given: [null, { extension }] };
  const quantity = {
    value: 185,
    unit: 'lbs',
    system: 'http://unitsofmeasure.org',
    code: '[lb_av]',
  };
  // Each data type on its own, and the element of a resource that holds the same value.
  const cases = [
    { inputType: 'Period', input: period, holder: { effectivePeriod: period }, path: 'effective' },
    { inputType: 'HumanName', input: name, holder: { name: [name] }, path: 'name' },
    { inputType: 'Quantity', input: quantity, holder: { valueQuantity: quantity }, path: 'value' },
  ] as const;
  const holderType = { Period: 'Observation', HumanName: 'Patient', Quantity: 'Observation' };
  const expressions: Readonly<Record<string, readonly string[]>> = {
    Period: [
      'start > @2019',
      'start is FHIR.dateTime',
      'start.extension.url',
      'end - start',
      'children().count()',
      'start.toString() & end',
      'start.length()',
      "start = 'x'",
    ],
    HumanName: [
      'given',
      "given.where(extension.exists()) = 'James'",
      'given.first().extension.value',
      'given.length()',
      "use = 'official'",
      'use is FHIR.code',
      'family.empty()',
    ],
    Quantity: [
      'value > 100',
      "$this > 80 'kg'",
      'unit.length()',
      'code is FHIR.code',
      'value.ofType(Quantity)',
    ],
  };
  /** An element each type does not have: empty at evaluation, a semantic error for analysis. */
  const unknownElements: Readonly<Record<string, string>> = {
    Period: 'stop',
    HumanName: 'givenName',
    Quantity: 'units',
  };

  async function outcomeOf(
    expression: string,
    input: unknown,
    options: CompileOptions,
  ): Promise<UncheckedOutcome> {
    try {
      return { ok: true, items: await compileUnchecked(expression, options).evaluateAsync(input) };
    } catch (error) {
      return { ok: false, error };
    }
  }

  const rows = cases.flatMap((row) =>
    [...(expressions[row.inputType] ?? []), unknownElements[row.inputType] ?? ''].map(
      (expression) => ({ ...row, expression }),
    ),
  );

  it.each(rows)('$inputType: $expression evaluates as the element of a resource', async (row) => {
    const options = { model, inputType: row.inputType };
    const holder = { resourceType: holderType[row.inputType], ...row.holder };
    const direct = await outcomeOf(row.expression, row.input, options);
    const reached = await outcomeOf(`${row.path}.select(${row.expression})`, holder, { model });
    expect(describeOutcome(direct)).toEqual(describeOutcome(reached));
  });

  // The soundness of the suite tests above, on inputs that do not name their type: lenient
  // analysis rejects nothing that evaluates, except an element the type does not have, which is
  // empty at evaluation and a semantic error, as in the suite's invalid="semantic" tests.
  it.each(rows)('$inputType: $expression is analyzed soundly', async (row) => {
    const options = { model, inputType: row.inputType };
    const errors = analyze(row.expression, options).diagnostics.filter(
      (d) => d.severity === 'error',
    );
    const outcome = await outcomeOf(row.expression, row.input, options);
    if (row.expression === unknownElements[row.inputType]) {
      expect(errors.map((d) => d.code)).toEqual(['semantic/unknown-element']);
      expect(outcome).toEqual({ ok: true, items: [] });
    } else if (outcome.ok) {
      expect(errors).toEqual([]);
    }
    const strict = analyze(row.expression, { ...options, strict: true }).diagnostics;
    if (!strict.some((d) => d.severity === 'error') && !outcome.ok) {
      expect(outcome.error).not.toMatchObject({ code: 'eval/singleton-expected' });
    }
  });
});

describe('strict analysis of a known collection through a function that maps each item', () => {
  // The rule behind the return hints: a function that gives zero or more items for each input
  // item repeats when its input does, so strict mode rejects a singleton use of its result, and
  // the evaluation confirms it on an input with two items.
  const extension = [{ url: 'http://example.org/x', valueString: 'x' }];
  const patient = {
    resourceType: 'Patient',
    contained: [
      { resourceType: 'Organization', id: 'a', extension },
      { resourceType: 'Organization', id: 'b', extension },
    ],
  };
  const options = { model: r4, inputType: 'Patient' };
  const strict = { ...options, strict: true };
  const errorsOf = (expression: string, mode: typeof options) =>
    analyze(expression, mode)
      .diagnostics.filter((d) => d.severity === 'error')
      .map((d) => d.code);
  const codeOf = async (expression: string): Promise<string | undefined> => {
    try {
      await compileUnchecked(expression, options).evaluateAsync(patient);
      return undefined;
    } catch (error) {
      return error instanceof FhirPathEvaluationError ? error.code : String(error);
    }
  };

  it.each([
    "('#a' | '#b').resolve().id.toString()",
    'contained.where(id.exists()).id.toString()',
    'contained.select(id).toString()',
    'contained.ofType(Organization).id.toString()',
    'contained.descendants().toString()',
    "contained.extension('http://example.org/x').value.toString()",
  ])('rejects %s, which fails at evaluation', async (expression) => {
    expect(errorsOf(expression, strict)).toEqual(['semantic/singleton-expected']);
    expect(errorsOf(expression, options)).toEqual([]);
    expect(await codeOf(expression)).toBe('eval/singleton-expected');
  });

  it.each([
    "('#a' | '#b').resolve().first().id.toString()",
    'contained.first().id.toString()',
    "contained.extension('http://example.org/x').first().value.toString()",
  ])('accepts %s, which evaluates', async (expression) => {
    expect(errorsOf(expression, strict)).toEqual([]);
    expect(await codeOf(expression)).toBeUndefined();
  });
});
