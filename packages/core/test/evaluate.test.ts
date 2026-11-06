/**
 * End-to-end tests of the internal compile and evaluate API without a model: navigation, literals,
 * the indexer, `$this`, `$index`, variables, Boolean logic and `is`/`as`
 * ([T0008 acceptance criteria](../../../docs/tasks/T0008-compiler-evaluator.md#acceptance-criteria)).
 */
import { describe, expect, it } from 'vitest';
import { compile, evaluate } from '../src/api/compile.ts';
import type { ErrorCode } from '../src/errors/error-codes.ts';
import { FhirPathError } from '../src/errors/fhirpath-error.ts';
import { ModelNode } from '../src/model/model-node.ts';
import { DateValue } from '../src/values/datetime/date.ts';
import { DateTimeValue } from '../src/values/datetime/datetime.ts';
import { TimeValue } from '../src/values/datetime/time.ts';
import { Decimal } from '../src/values/decimal/decimal.ts';
import { Quantity } from '../src/values/quantity/quantity.ts';
import { testRegistry } from './support/test-functions.ts';

const patient = {
  resourceType: 'Patient',
  id: 'example',
  active: true,
  name: [
    { use: 'official', given: ['Peter', 'James'], family: 'Chalmers' },
    { use: 'usual', given: ['Jim'] },
    { use: 'maiden', given: ['Peter', 'James'], family: 'Windsor' },
  ],
  birthDate: '1974-12-25',
  multipleBirthInteger: 2,
  weight: 72.5,
};

const functions = testRegistry();

function run(expression: string, input: unknown = patient, variables?: Record<string, unknown>) {
  return evaluate(input, expression, {
    functions,
    ...(variables === undefined ? {} : { variables }),
  });
}

function typed(expression: string, input: unknown = patient): unknown[] {
  return evaluate(input, expression, { functions, output: 'typed' });
}

function errorOf(action: () => unknown): FhirPathError {
  try {
    action();
  } catch (error) {
    if (error instanceof FhirPathError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected an error');
}

function codeOf(action: () => unknown): ErrorCode {
  return errorOf(action).code;
}

describe('navigation', () => {
  // https://hl7.org/fhirpath/N1/#path-selection
  it.each<[string, unknown[]]>([
    ['Patient.name.given', ['Peter', 'James', 'Jim', 'Peter', 'James']],
    ['name.given', ['Peter', 'James', 'Jim', 'Peter', 'James']],
    ['Patient.name.family', ['Chalmers', 'Windsor']],
    ['Patient.active', [true]],
    ['Patient.multipleBirthInteger', [2]],
    ['Patient.weight', [72.5]],
    ['Patient.missing', []],
    ['Patient.name.missing', []],
    ['Patient.active.value', []],
  ])('%s', (expression, expected) => {
    expect(run(expression)).toEqual(expected);
  });

  it('flattens arrays in document order and keeps duplicates', () => {
    expect(run('name.given')).toEqual(['Peter', 'James', 'Jim', 'Peter', 'James']);
  });

  it('skips null values and null array elements', () => {
    expect(run('a.b', { a: [{ b: null }, null, { b: [1, null, 2] }] })).toEqual([1, 2]);
  });

  // The root identifier rule without a model: https://hl7.org/fhirpath/N1/#models
  it('treats a root identifier equal to the input resourceType as the type', () => {
    expect(run('Patient.id')).toEqual(['example']);
  });

  it('treats any other root identifier as a path', () => {
    expect(run('Observation.id')).toEqual([]);
    expect(run('Patient.id', { Patient: { id: 'nested' } })).toEqual(['nested']);
  });

  it('does not match a resourceType that is inherited or not a string', () => {
    const inherited = Object.create({ resourceType: 'Patient' }) as object;
    expect(run('Patient', inherited)).toEqual([]);
    expect(run('Patient', { resourceType: ['Patient'] })).toEqual([]);
  });

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
    'returns empty for the prototype member %s',
    (name) => {
      expect(run(`Patient.${name}`)).toEqual([]);
      expect(run(`Patient.\`${name}\``)).toEqual([]);
      expect(run(name, {})).toEqual([]);
    },
  );

  it('reads an own property named like a prototype member as data', () => {
    expect(run('constructor', { constructor: 'own' })).toEqual(['own']);
    expect(run('a.__proto__', JSON.parse('{"a": {"__proto__": 1}}'))).toEqual([1]);
  });

  it('wraps every input value in a node, with its name, parent and index', () => {
    const [node] = typed('Patient.name[1].given');
    expect(node).toBeInstanceOf(ModelNode);
    if (node instanceof ModelNode) {
      expect(node.value).toBe('Jim');
      expect(node.name).toBe('given');
      expect(node.index).toBe(0);
      expect(node.parent?.name).toBe('name');
      expect(node.parent?.index).toBe(1);
      expect(node.parent?.parent?.name).toBe('Patient');
    }
  });

  it('does not change the input', () => {
    const before = JSON.stringify(patient);
    run('Patient.name.given');
    expect(JSON.stringify(patient)).toBe(before);
  });

  it('evaluates an array input as a collection, and undefined or null as empty', () => {
    expect(run('id', [{ id: 'a' }, { id: 'b' }])).toEqual(['a', 'b']);
    expect(evaluate(undefined, 'id')).toEqual([]);
    expect(evaluate(null, 'id')).toEqual([]);
  });
});

describe('literals', () => {
  // https://hl7.org/fhirpath/N1/#literals
  it.each<[string, unknown]>([
    ['true', true],
    ['false', false],
    ["'text'", 'text'],
    ["'it\\'s'", "it's"],
    ['0', 0],
    ['42', 42],
    ['-5', -5],
    ['2147483647', 2147483647],
    ['-2147483648', -2147483648],
  ])('%s', (expression, expected) => {
    expect(run(expression, {})).toEqual([expected]);
  });

  it('gives {} as the empty collection', () => {
    expect(run('{}')).toEqual([]);
  });

  it.each<[string, string]>([
    ['1.0', '1.0'],
    ['0.5', '0.5'],
    ['-1.50', '-1.50'],
    ['3.14159265358979323846264338327950288', '3.14159265358979323846264338327950288'],
  ])('builds the Decimal %s with its precision', (expression, text) => {
    const [value] = typed(expression);
    expect(value).toBeInstanceOf(Decimal);
    expect(String(value)).toBe(text);
  });

  it.each<[string, typeof DateValue | typeof DateTimeValue | typeof TimeValue, string]>([
    ['@2015', DateValue, '2015'],
    ['@2015-02', DateValue, '2015-02'],
    ['@2015-02-04', DateValue, '2015-02-04'],
    ['@2015-02-04T14:34:28', DateTimeValue, '2015-02-04T14:34:28'],
    ['@2015-02-04T14:34:28.123Z', DateTimeValue, '2015-02-04T14:34:28.123Z'],
    ['@2015-02-04T14:34:28+02:00', DateTimeValue, '2015-02-04T14:34:28+02:00'],
    ['@2015T', DateTimeValue, '2015'],
    ['@T14', TimeValue, '14'],
    ['@T14:34:28.123', TimeValue, '14:34:28.123'],
  ])('builds the date/time %s', (expression, type, text) => {
    const [value] = typed(expression);
    expect(value).toBeInstanceOf(type);
    expect(String(value)).toBe(text);
  });

  it.each<[string, string, string]>([
    ["5 'mg'", '5', 'mg'],
    ["4.5 'cm'", '4.5', 'cm'],
    ['3 days', '3', 'day'],
    ['1 year', '1', 'year'],
    ["-5.5 'mg'", '-5.5', 'mg'],
  ])('builds the Quantity %s', (expression, value, unit) => {
    const [quantity] = typed(expression);
    expect(quantity).toBeInstanceOf(Quantity);
    if (quantity instanceof Quantity) {
      expect(quantity.value.toString()).toBe(value);
      expect(quantity.unit).toBe(unit);
    }
  });

  it('builds a literal once, at compile time', () => {
    const compiled = compile('@2015-02-04');
    const [first] = compiled.evaluate({}, { output: 'typed' });
    const [second] = compiled.evaluate({}, { output: 'typed' });
    expect(first).toBe(second);
  });

  // https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md#invalid-literal-values
  describe('with a value that is not allowed', () => {
    it.each([
      '@2015-02-30',
      '@2015-13',
      '@2015-02-04T25:00:00',
      '@T14:34:28Z', // testLiteralTimeUTC
      '@T14:34:28+10:00', // testLiteralTimeTimezoneOffset
      '2147483648',
      '-2147483649',
      `1.${'0'.repeat(10_001)}`,
      `${'9'.repeat(10_001)}.5 'mg'`,
    ])('compiles %s, then raises eval/invalid-literal when it is evaluated', (expression) => {
      const compiled = compile(expression);
      expect(codeOf(() => compiled.evaluate({}))).toBe('eval/invalid-literal');
    });

    it('does not raise in a branch that is not evaluated', () => {
      expect(run('testIif(true, 1, @2015-02-30)')).toEqual([1]);
      expect(codeOf(() => run('testIif(false, 1, @2015-02-30)'))).toBe('eval/invalid-literal');
    });

    it('reports where the literal is', () => {
      const error = errorOf(() => compile('true and @2015-02-30').evaluate({}));
      expect(error.span).toMatchObject({ start: 9, end: 20, line: 1, column: 10 });
      expect(error.expression).toBe('true and @2015-02-30');
    });
  });
});

describe('the indexer', () => {
  // https://hl7.org/fhirpath/N1/#index-integer-collection
  it.each<[string, unknown[]]>([
    ['Patient.name[0].use', ['official']],
    ['Patient.name[2].family', ['Windsor']],
    ['Patient.name.given[2]', ['Jim']],
    ['Patient.name[3]', []],
    ['Patient.name[-1]', []], // testIndexer3
    ['Patient.name[{}]', []],
    ['{}[0]', []],
    ["('a')[0]", ['a']],
  ])('%s', (expression, expected) => {
    expect(run(expression)).toEqual(expected);
  });

  it('keeps the node it selects', () => {
    const [selected] = typed('Patient.name[1]');
    expect(selected).toBeInstanceOf(ModelNode);
    expect(selected instanceof ModelNode && selected.value).toBe(patient.name[1]);
    expect(selected instanceof ModelNode && selected.index).toBe(1);
  });

  it('evaluates the index with the focus of the indexer, not with the target', () => {
    expect(run('name[multipleBirthInteger].use')).toEqual(['maiden']);
    expect(run('name[%i].use', patient, { i: 1 })).toEqual(['usual']);
  });

  it('raises eval/singleton-expected for more than one index', () => {
    expect(codeOf(() => run('name[name.given.count()]'))).toBe('semantic/unknown-function');
    expect(codeOf(() => run('name[%i]', patient, { i: [0, 1] }))).toBe('eval/singleton-expected');
  });

  it.each(["name['0']", 'name[0.0]', 'name[true]'])(
    'raises eval/type-mismatch for the index in %s',
    (expression) => {
      expect(codeOf(() => run(expression))).toBe('eval/type-mismatch');
    },
  );
});

describe('$this and $index', () => {
  // https://hl7.org/fhirpath/N1/#functions
  it('is the item for each evaluation of a lambda', () => {
    expect(run('name.testSelect($this.use)')).toEqual(['official', 'usual', 'maiden']);
    expect(run('name.testWhere($this.family is String).use')).toEqual(['official', 'maiden']);
  });

  it('gives $index as the position of the item', () => {
    expect(run('name.testSelect($index)')).toEqual([0, 1, 2]);
    expect(run('name.given.testSelect($index)')).toEqual([0, 1, 2, 3, 4]);
  });

  it('gives nested lambdas their own $this and $index', () => {
    expect(run('name.testSelect(given.testSelect($index))')).toEqual([0, 1, 0, 0, 1]);
    expect(run('name.testSelect(given.testSelect($this))')).toEqual([
      'Peter',
      'James',
      'Jim',
      'Peter',
      'James',
    ]);
  });

  it('is the input outside a lambda, and $index is empty', () => {
    expect(run('$this.id')).toEqual(['example']);
    expect(run('$index')).toEqual([]);
    expect(run('$total')).toEqual([]);
  });

  // https://github.com/losol/callis/blob/main/docs/spec-notes.md#frame-variables-after-a-dot
  it('evaluates the target of a frame variable after a dot, and gives the variable', () => {
    expect(run('name.testSelect(given.$index)')).toEqual([0, 1, 2]);
    expect(codeOf(() => run('@2015-02-30.$this'))).toBe('eval/invalid-literal');
  });
});

describe('variables', () => {
  // https://hl7.org/fhirpath/N1/#environment-variables
  it('gives %context as the input', () => {
    expect(run('%context.id')).toEqual(['example']);
    expect(run('name.testSelect(%context.id)')).toEqual(['example', 'example', 'example']);
  });

  it("gives %ucum as UCUM's URL", () => {
    expect(run('%ucum')).toEqual(['http://unitsofmeasure.org']);
  });

  it('gives user variables, as input data', () => {
    expect(run('%a', patient, { a: 'x' })).toEqual(['x']);
    expect(run('%list', patient, { list: [1, 2, 3] })).toEqual([1, 2, 3]);
    expect(run('%obj.b', patient, { obj: { b: [true, false] } })).toEqual([true, false]);
    expect(run('%`with space`', patient, { 'with space': 1 })).toEqual([1]);
    expect(run("%'quoted'", patient, { quoted: 2 })).toEqual([2]);
  });

  it.each([undefined, null, []])('gives a variable defined as %j as empty', (value) => {
    expect(run('%v', patient, { v: value })).toEqual([]);
  });

  it('accepts typed values and nodes as variable values', () => {
    const [quantity] = evaluate({}, '%q', {
      variables: { q: new Quantity(Decimal.ONE, 'mg') },
      output: 'typed',
    });
    expect(quantity).toBeInstanceOf(Quantity);
  });

  it('does not let user variables replace %context and %ucum', () => {
    expect(run('%ucum', patient, { ucum: 'other' })).toEqual(['http://unitsofmeasure.org']);
    expect(run('%context.id', patient, { context: { id: 'other' } })).toEqual(['example']);
  });

  it.each(['%undefined', '%constructor', '%toString', '%__proto__'])(
    'raises eval/undefined-variable for %s',
    (expression) => {
      const error = errorOf(() => run(expression));
      expect(error.code).toBe('eval/undefined-variable');
      expect(error.span).toMatchObject({ start: 0, end: expression.length });
    },
  );

  it('raises eval/undefined-variable only when the variable is evaluated', () => {
    expect(run('testIif(true, 1, %undefined)')).toEqual([1]);
  });
});

describe('Boolean logic', () => {
  // https://hl7.org/fhirpath/N1/#boolean-logic
  const values = { T: true, F: false, E: {} } as const;
  const literal = (value: keyof typeof values): string =>
    value === 'E' ? '{}' : String(values[value]);
  const tables: Record<'and' | 'or' | 'xor' | 'implies', Record<string, boolean | undefined>> = {
    and: {
      TT: true,
      TF: false,
      TE: undefined,
      FT: false,
      FF: false,
      FE: false,
      ET: undefined,
      EF: false,
      EE: undefined,
    },
    or: {
      TT: true,
      TF: true,
      TE: true,
      FT: true,
      FF: false,
      FE: undefined,
      ET: true,
      EF: undefined,
      EE: undefined,
    },
    xor: {
      TT: false,
      TF: true,
      TE: undefined,
      FT: true,
      FF: false,
      FE: undefined,
      ET: undefined,
      EF: undefined,
      EE: undefined,
    },
    implies: {
      TT: true,
      TF: false,
      TE: undefined,
      FT: true,
      FF: true,
      FE: true,
      ET: true,
      EF: undefined,
      EE: undefined,
    },
  };
  for (const [op, table] of Object.entries(tables)) {
    for (const [pair, expected] of Object.entries(table)) {
      const left = pair[0] as keyof typeof values;
      const right = pair[1] as keyof typeof values;
      const expression = `${literal(left)} ${op} ${literal(right)}`;
      it(`${expression} is ${expected === undefined ? 'empty' : expected}`, () => {
        expect(run(expression)).toEqual(expected === undefined ? [] : [expected]);
      });
    }
  }

  it.each<[string, unknown[]]>([
    ['true.not()', [false]],
    ['false.not()', [true]],
    ['{}.not()', []],
    ['Patient.active.not()', [false]],
    ["'a'.not()", [false]], // a single non-Boolean item is true (N1 §4.5)
  ])('%s', (expression, expected) => {
    expect(run(expression)).toEqual(expected);
  });

  it('converts input nodes and other single items by singleton evaluation', () => {
    expect(run('Patient.active and true')).toEqual([true]);
    expect(run("'text' and true")).toEqual([true]);
    expect(run('name.use.first and true')).toEqual([]);
  });

  it('evaluates both operands, so an error on the right surfaces', () => {
    expect(codeOf(() => run('false and %undefined'))).toBe('eval/undefined-variable');
    expect(codeOf(() => run('true or %undefined'))).toBe('eval/undefined-variable');
    expect(codeOf(() => run('false implies @2015-02-30'))).toBe('eval/invalid-literal');
  });

  it('raises eval/singleton-expected for an operand with more than one item', () => {
    const error = errorOf(() => run('Patient.name.use and true'));
    expect(error.code).toBe('eval/singleton-expected');
    expect(error.span).toMatchObject({ start: 0, end: 25 });
  });
});

describe('unary + and -', () => {
  // https://hl7.org/fhirpath/N1/#math
  it.each<[string, unknown[]]>([
    ['-Patient.multipleBirthInteger', [-2]],
    ['+Patient.multipleBirthInteger', [2]],
    ['-Patient.weight', [-72.5]],
    ['-(5)', [-5]],
    ['- -5', [5]],
    ['-%i', [2147483647]],
    ['-{}', []],
    ['-Patient.missing', []],
  ])('%s', (expression, expected) => {
    expect(run(expression, patient, { i: -2147483647 })).toEqual(expected);
  });

  it('gives empty when negating the smallest Integer overflows', () => {
    expect(run('-%i', patient, { i: -2147483648 })).toEqual([]);
  });

  // Folding a literal must give what evaluating the same value gives.
  it.each<[string, string, unknown[]]>([
    ['-(-2147483648)', '-%min', []],
    ['-(-(-2147483648))', '-(-%min)', []],
    ['- -2147483647', '- -%max', [2147483647]],
    ['-(-(-2147483647))', '-(-%min1)', [-2147483647]],
    ['+(-2147483648)', '+%min', [-2147483648]],
  ])('folds %s like it evaluates %s', (folded, evaluated, expected) => {
    const variables = { min: -2147483648, max: 2147483647, min1: -2147483647 };
    expect(run(folded)).toEqual(expected);
    expect(run(evaluated, patient, variables)).toEqual(expected);
  });

  it('negates a Decimal and a Quantity', () => {
    const [decimal] = evaluate({}, '-%d', {
      variables: { d: Decimal.parse('1.50') },
      output: 'typed',
    });
    expect(String(decimal)).toBe('-1.50');
    const [quantity] = evaluate({}, '-%q', {
      variables: { q: new Quantity(Decimal.ONE, 'mg') },
      output: 'typed',
    });
    expect(String(quantity)).toBe("-1 'mg'");
  });

  it.each(["-'a'", '-true', '-@2015', '-Patient.name'])('raises an error for %s', (expression) => {
    expect(['eval/type-mismatch', 'eval/singleton-expected']).toContain(
      codeOf(() => run(expression)),
    );
  });
});

describe('is and as with System types', () => {
  // https://hl7.org/fhirpath/N1/#types
  it.each<[string, unknown[]]>([
    ['true is Boolean', [true]],
    ["'a' is String", [true]],
    ['1 is Integer', [true]],
    ['1 is Decimal', [false]], // no subtyping between Integer and Decimal
    ['1.0 is Decimal', [true]],
    ['@2015 is Date', [true]],
    ['@2015 is DateTime', [false]],
    ['@2015T is DateTime', [true]],
    ['@T10 is Time', [true]],
    ["1 'mg' is Quantity", [true]],
    ['1 is System.Integer', [true]],
    ['1 is System.Any', [true]],
    ['Patient is System.Any', [true]],
    ['Patient.active is Boolean', [true]],
    ['Patient.birthDate is String', [true]],
    ['Patient.birthDate is Date', [false]],
    ['Patient.multipleBirthInteger is Integer', [true]],
    ['Patient.weight is Decimal', [true]],
    ['{} is Integer', [false]], // 3.0.0: empty input gives false
    ['1.is(Integer)', [true]],
    ['1.is(System.String)', [false]],
    ["'a' as String", ['a']],
    ['1 as String', []],
    ['{} as String', []],
    ['1.as(Integer)', [1]],
    ['Patient.active as Boolean', [true]],
  ])('%s', (expression, expected) => {
    expect(run(expression)).toEqual(expected);
  });

  it('keeps the node that as selects', () => {
    const [node] = typed('Patient.active as Boolean');
    expect(node).toBeInstanceOf(ModelNode);
  });

  it.each(['Patient.name.use is String', 'Patient.name.use as String', 'name.use.is(String)'])(
    'raises eval/singleton-expected for more than one item: %s',
    (expression) => {
      expect(codeOf(() => run(expression))).toBe('eval/singleton-expected');
    },
  );

  it('raises semantic/invalid-argument when a type argument is not a type name', () => {
    expect(codeOf(() => compile("1.is('Integer')"))).toBe('semantic/invalid-argument');
    expect(codeOf(() => compile('1.as(1 + 1)'))).toBe('semantic/invalid-argument');
  });
});

// https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md#type-names-that-do-not-resolve
describe('type names that do not resolve', () => {
  const unknown = ['System.Patient', 'Foo.Patient', 'FHIR.Patient', 'System.string', 'Foo.Bar.Baz'];

  it.each(
    unknown.flatMap((type) => [`1 is ${type}`, `1 as ${type}`, `1.is(${type})`, `1.as(${type})`]),
  )('compiles %s, then raises eval/unknown-type', (expression) => {
    const compiled = compile(expression);
    const error = errorOf(() => compiled.evaluate({}));
    expect(error.code).toBe('eval/unknown-type');
    expect(error.span).toMatchObject({ start: 0, end: expression.length });
  });

  it.each(
    unknown.flatMap((type) => [`{} is ${type}`, `{} as ${type}`, `Patient.missing.is(${type})`]),
  )('raises eval/unknown-type on empty input: %s', (expression) => {
    expect(codeOf(() => run(expression))).toBe('eval/unknown-type');
  });

  it('raises eval/unknown-type before the singleton check', () => {
    expect(codeOf(() => run('Patient.name.use is System.Patient'))).toBe('eval/unknown-type');
  });

  it('does not raise in a branch that is not evaluated', () => {
    expect(run('testIif(true, 1, 1 is System.Patient)')).toEqual([1]);
    expect(run('testIif(false, 1 as Foo.Patient, 2)')).toEqual([2]);
  });

  it('keeps resolved System mismatches false or empty', () => {
    expect(run("'a' is System.Integer")).toEqual([false]);
    expect(run("'a' as System.Integer")).toEqual([]);
  });
});

// https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md#resource-type-names-without-a-model
describe('resource type names without a model', () => {
  const bundle = {
    contained: [
      { resourceType: 'Patient', id: 'p' },
      { resourceType: 'Observation', id: 'o' },
    ],
  };

  it.each<[string, unknown[]]>([
    ['contained[0] is Patient', [true]],
    ['contained[1] is Patient', [false]],
    ['contained[1] is Observation', [true]],
    ['contained[0].is(Patient)', [true]],
    ['contained.testWhere($this is Patient).id', ['p']],
    ['contained[1] as Observation', [{ resourceType: 'Observation', id: 'o' }]],
    ['contained[0] as Observation', []],
    ['contained[0].as(Patient).id', ['p']],
  ])('%s', (expression, expected) => {
    expect(run(expression, bundle)).toEqual(expected);
  });

  it('does not treat a string as a resource', () => {
    expect(run("'Patient' is Patient", bundle)).toEqual([false]);
    expect(run("'Patient' as Patient", bundle)).toEqual([]);
  });

  it('treats a misspelled or absent resource name as a valid target that does not match', () => {
    expect(run('contained[0] is Pateint', bundle)).toEqual([false]);
    expect(run('contained[0] as Pateint', bundle)).toEqual([]);
    expect(run('contained[0] is patient', bundle)).toEqual([false]);
    expect(run('{} is Pateint', bundle)).toEqual([false]);
  });

  it('gives System names precedence over resourceType', () => {
    const input = { item: { resourceType: 'String' } };
    expect(run('item is String', input)).toEqual([false]);
    expect(run('item is System.String', input)).toEqual([false]);
    expect(run("'a' is String", input)).toEqual([true]);
  });

  it('needs an own string resourceType', () => {
    const inherited = Object.create({ resourceType: 'Patient' }) as object;
    expect(run('%r is Patient', {}, { r: inherited })).toEqual([false]);
    expect(run('item is Patient', { item: { resourceType: 1 } })).toEqual([false]);
    expect(run('item is Patient', { item: { resourceType: null } })).toEqual([false]);
    expect(run('item is Patient', { item: {} })).toEqual([false]);
    expect(run('item is Patient', { item: 'Patient' })).toEqual([false]);
    expect(run('item is Patient', { item: 1 })).toEqual([false]);
  });

  it('infers no inheritance', () => {
    expect(run('contained[0] is Resource', bundle)).toEqual([false]);
    expect(run('contained[0] is DomainResource', bundle)).toEqual([false]);
    expect(run('item is Resource', { item: { resourceType: 'Resource' } })).toEqual([true]);
  });

  it('applies the singleton rules for valid targets', () => {
    expect(run('contained.missing is Patient', bundle)).toEqual([false]);
    expect(run('contained.missing as Patient', bundle)).toEqual([]);
    expect(codeOf(() => run('contained is Patient', bundle))).toBe('eval/singleton-expected');
    expect(codeOf(() => run('contained as Patient', bundle))).toBe('eval/singleton-expected');
  });

  it('never makes a qualified name a resource-name target', () => {
    expect(codeOf(() => run('contained[0] is FHIR.Patient', bundle))).toBe('eval/unknown-type');
  });
});

describe('functions', () => {
  it('raises semantic/unknown-function at compile time', () => {
    const error = errorOf(() => compile('Patient.name.noSuchFunction()'));
    expect(error.code).toBe('semantic/unknown-function');
    expect(error.span).toMatchObject({ start: 0, end: 29 });
  });

  it('raises semantic/wrong-arity at compile time', () => {
    expect(codeOf(() => compile('true.not(1)'))).toBe('semantic/wrong-arity');
    expect(codeOf(() => compile('1.is()'))).toBe('semantic/wrong-arity');
  });

  it('evaluates value arguments with the focus of the call, not with its target', () => {
    // `use is String` is evaluated on each name; on `given` it would be false.
    expect(run("name.testSelect(given.testIif(use is String, family, 'none'))")).toEqual([
      'Chalmers',
      'Windsor',
    ]);
  });
});

describe('operators of later tasks', () => {
  it.each<[string, string]>([
    ['noSuchFunction() + 1', 'semantic/unknown-function'],
    ['true.not(1) = false', 'semantic/wrong-arity'],
    ["1 | 1.is('Integer')", 'semantic/invalid-argument'],
  ])('still checks the operands of %s at compile time', (expression, code) => {
    expect(codeOf(() => compile(expression))).toBe(code);
  });

  it.each(['1 = 1', '1 + 1', "'a' & 'b'", '1 | 2', '1 < 2', '1 in 1'])(
    'compiles %s and raises eval/not-implemented when it is evaluated',
    (expression) => {
      const compiled = compile(expression);
      expect(codeOf(() => compiled.evaluate({}))).toBe('eval/not-implemented');
    },
  );
});
