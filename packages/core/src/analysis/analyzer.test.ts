/**
 * Static analysis through the internal `analyze()` and `compile()`, with the mini FHIR model
 * ([T0024](../../../../docs/tasks/T0024-static-analysis.md)). The generated providers are
 * covered in `test/generated-models.test.ts`, and the HL7 suite's `isSemanticChecks` group by
 * the conformance runner.
 */
import { describe, expect, it } from 'vitest';
import { stubModel } from '../../test/support/stub-model.ts';
import { analyze, type CompileOptions, compile, evaluate } from '../api/compile.ts';
import type { Diagnostic } from '../errors/diagnostic.ts';
import { FhirPathError } from '../errors/fhirpath-error.ts';

const model: CompileOptions = { model: stubModel };
const patient: CompileOptions = { model: stubModel, inputType: 'Patient' };
const observation: CompileOptions = { model: stubModel, inputType: 'Observation' };

/** The diagnostics as `severity code` strings, in order. */
function report(expression: string, options: CompileOptions = {}): string[] {
  return analyze(expression, options).diagnostics.map(
    (diagnostic) => `${diagnostic.severity} ${diagnostic.code}`,
  );
}

function first(expression: string, options: CompileOptions = {}): Diagnostic | undefined {
  return analyze(expression, options).diagnostics[0];
}

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof FhirPathError) {
      return error.code;
    }
    throw error;
  }
  return undefined;
}

describe('analysis of every expression', () => {
  it('reports an unknown function, a wrong arity and a type argument that is not a type', () => {
    expect(report('foo()')).toEqual(['error semantic/unknown-function']);
    expect(report('first(1)')).toEqual(['error semantic/wrong-arity']);
    expect(report('ofType(1)')).toEqual(['error semantic/invalid-argument']);
    expect(report("name.is('x')")).toEqual(['error semantic/invalid-argument']);
  });

  // https://hl7.org/fhirpath/N1/#aggregates: $total is the accumulator of aggregate() (T0026).
  it('reports $total outside aggregate()', () => {
    expect(report('$total')).toEqual(['error semantic/undefined-variable']);
    expect(report('name.select($total)')).toEqual(['error semantic/undefined-variable']);
  });

  it('reports every problem, in source order, with spans', () => {
    const { diagnostics } = analyze("foo() + bar(1 + 'a')");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'semantic/unknown-function',
      'semantic/unknown-function',
    ]);
    expect(diagnostics.map((diagnostic) => diagnostic.span?.start)).toEqual([0, 8]);
    expect(diagnostics[0]?.span).toMatchObject({ line: 1, column: 1, end: 5 });
  });

  it('reports a syntax error as a diagnostic instead of throwing', () => {
    expect(first('Patient.')).toMatchObject({
      severity: 'error',
      code: 'syntax/unexpected-token',
      span: { start: 8 },
    });
    expect(first('(1')).toMatchObject({ code: 'syntax/unexpected-token' });
  });

  it('is empty for a valid expression', () => {
    expect(report("Patient.name.where(use = 'official').given.first()")).toEqual([]);
    expect(report('1 + 2 * 3 > 4 and true implies false')).toEqual([]);
  });
});

// https://hl7.org/fhirpath/N1/#operations: an operator whose operands it never accepts raises
// eval/type-mismatch when evaluated; the suite expects that execution error (testMinus4), so
// analysis warns. docs/spec-notes.md#function-types-are-checked-statically-operator-types-when-evaluated
describe('operator types', () => {
  it.each([
    "1 + 'a'",
    "'a' - 'b'",
    "'a' * 'b'",
    'true / 2',
    "1 div '2'",
    "1 mod '2'",
    '1 day + @2020',
    '1 day div 1 day',
    "1 < 'a'",
    'true < false',
    "1 >= '1'",
    "-'a'",
    '-@2015',
    '+true',
    "'a' & true",
    "name['0']",
    'name[0.0]',
    'name[true]',
    '1 > 2 is Boolean',
    '-1.convertsToInteger()',
    "@2020 + 1 'mg'",
    "@2020 + 1 'a'",
    "@2020 - 1 'mo'",
    '@2020-01-01 + 1 hour',
    '@T12 + 1 day',
  ])('warns about %s, which still compiles and fails when evaluated', (expression) => {
    expect(report(expression)).toEqual(['warning semantic/type-mismatch']);
    expect(() => compile(expression)).not.toThrow();
    expect(codeOf(() => evaluate({ name: ['a'] }, expression))).toMatch(/^eval\//);
  });

  it('warns once per operand of &', () => {
    expect(report('1 & 2')).toEqual([
      'warning semantic/type-mismatch',
      'warning semantic/type-mismatch',
    ]);
  });

  it('accepts every pair the kernels accept', () => {
    for (const expression of [
      '1 + 1.5',
      "'a' + 'b'",
      '@2020 + 1 year',
      '@T12 + 1 hour',
      '@2020-01-01T10:00 - 30 minutes',
      "5 'mg' + 1",
      "1 / 5 'mg'",
      "5 'mg' * 2",
      '1 < 1.5',
      "1 < 5 'mg'",
      '@2020 < @2020-01-01T00:00',
      '@T10 < @T11',
      "'a' < 'b'",
      "'a' & {}",
      '{} + 1',
      "name & 'x'",
      'name + 1',
    ]) {
      expect(report(expression)).toEqual([]);
    }
  });

  it('infers the type of a result, so the next operator is checked', () => {
    expect(report("(1 + 2) + 'a'")).toEqual(['warning semantic/type-mismatch']);
    expect(report("('a' + 'b') + 1")).toEqual(['warning semantic/type-mismatch']);
    expect(report('(1 / 2).substring(0)')).toEqual(['error semantic/type-mismatch']);
    expect(report('(1 + 2).substring(0)')).toEqual(['error semantic/type-mismatch']);
    expect(report("(@2020 + 1 year) + 'a'")).toEqual(['warning semantic/type-mismatch']);
    expect(report("(5 'mg' + 1).unit", model)).toEqual(['error semantic/unknown-element']);
  });

  it('never warns about an operand whose type is unknown', () => {
    for (const expression of ['name + 1', '%v - 1', '$this * 2', 'name < 1', "'a' & name"]) {
      expect(report(expression)).toEqual([]);
    }
  });

  it('says nothing about equality in lenient mode', () => {
    expect(report("1 = 'a'")).toEqual([]);
    expect(report("name = 'a'")).toEqual([]);
    expect(report('(1 | 2) ~ 1')).toEqual([]);
  });

  it('makes the warnings errors in strict mode', () => {
    expect(report("1 + 'a'", { strict: true })).toEqual(['error semantic/type-mismatch']);
    expect(codeOf(() => compile("1 + 'a'", { strict: true }))).toBe('semantic/type-mismatch');
  });
});

// https://hl7.org/fhirpath/N1/#functions: the input and the arguments of a function must have
// the types it takes (testStartsWithNonString1 and isEffectOnLogic3Base expect semantic errors).
describe('function types', () => {
  it.each([
    "'a'.abs()",
    '1.substring(0)',
    '(1).length()',
    'true.upper()',
    "skip('1')",
    'take(1.5)',
    "'abc'.substring(1.5)",
    "'abc'.indexOf(1)",
    'trace(1)',
    "'a'.anyTrue()",
    '1.toQuantity(1)',
    "(5 'mg').exp()",
    '2.5.round(1.5)',
    "'987654321'.startsWith(length())",
    "@2020.toString().length().startsWith('x')",
    '1.extension(1)',
    '1.memberOf(1)',
  ])('rejects %s', (expression) => {
    expect(report(expression)).toEqual(['error semantic/type-mismatch']);
    expect(codeOf(() => compile(expression))).toBe('semantic/type-mismatch');
  });

  it('accepts an input when one of its possible types fits', () => {
    expect(report("(true | 'foo').allTrue()")).toEqual([]);
    expect(report("iif(true, 1, 'a').substring(0)")).toEqual([]);
    expect(report("(1 | 'a').first().substring(0)")).toEqual([]);
  });

  it('accepts what converts implicitly', () => {
    expect(report('1.sqrt()')).toEqual([]);
    expect(report('1.toQuantity()')).toEqual([]);
    expect(report("(5 'mg').abs()")).toEqual([]);
    expect(report('@2020.toString()')).toEqual([]);
    expect(report("'a'.toDateTime()")).toEqual([]);
  });

  it('checks the argument where the call is written (testSubstring10a)', () => {
    expect(report('name.family.first().substring(2, length() - 5)', patient)).toEqual([
      'error semantic/type-mismatch',
    ]);
    expect(first('name.family.first().substring(2, length() - 5)', patient)?.span?.start).toBe(33);
    expect(report('name.family.first().substring(2, length() - 5)')).toEqual([]);
  });

  it('checks the result of a lambda where the function expects a type, in strict mode only', () => {
    expect(report("iif('x', 1, 2)")).toEqual([]);
    expect(report("iif('x', 1, 2)", { strict: true })).toEqual(['error semantic/type-mismatch']);
    expect(report("name.where('x')", { strict: true })).toEqual(['error semantic/type-mismatch']);
    expect(report('name.exists(1)', { strict: true })).toEqual(['error semantic/type-mismatch']);
    expect(report('name.all(given)', { strict: true })).toEqual([]);
  });

  it('leaves a Boolean context to singleton evaluation unless strict', () => {
    expect(report("'a' and true")).toEqual([]);
    expect(report("'a' and true", { strict: true })).toEqual(['error semantic/type-mismatch']);
    expect(report('1.not()')).toEqual([]);
    expect(report('1.not()', { strict: true })).toEqual(['error semantic/type-mismatch']);
    // The Boolean rule is for a single item; a collection of Booleans is checked as such.
    expect(report("'a'.allTrue()", { strict: true })).toEqual(['error semantic/type-mismatch']);
  });
});

// docs/spec-notes.md#unresolved-type-specifiers-are-execution-errors
describe('type specifiers', () => {
  it('warns about a type that does not resolve, and keeps the error for evaluation', () => {
    for (const [expression, options] of [
      ['Patient is Pateint', model],
      ['Patient.gender.as(string1)', model],
      ['Patient.gender.ofType(string1)', model],
      ['Patient is System.Patient', {}],
      ['Patient is FHIR.Patient', {}],
      ['gender.as(Foo.Patient)', {}],
    ] as const) {
      expect(report(expression, options)).toEqual(['warning semantic/unknown-type']);
      expect(report(expression, { ...options, strict: true })).toEqual([
        'warning semantic/unknown-type',
      ]);
      expect(() => compile(expression, { ...options, strict: true })).not.toThrow();
      expect(codeOf(() => evaluate({ resourceType: 'Patient' }, expression, options))).toBe(
        'eval/unknown-type',
      );
    }
  });

  it('says nothing about a model-less resource name or a known nonmatching type', () => {
    expect(report('Patient is Pateint')).toEqual([]);
    expect(report('contained.ofType(Observation)')).toEqual([]);
    expect(report('Patient.active is String', model)).toEqual([]);
    expect(report("'a' is Integer")).toEqual([]);
  });

  it('treats a value that can have no item as empty, whatever it was', () => {
    expect(report('(1 | 2).ofType(System.String).foo', model)).toEqual([]);
    expect(report('(1 | 2).select({}).foo', model)).toEqual([]);
    expect(report('name.ofType(Period).unit', patient)).toEqual([]);
    expect(report('name.first().as(Period).start.foo', patient)).toEqual([]);
    expect(report("(1 | 2).ofType(System.String) + 'a'")).toEqual([]);
  });

  it('narrows the types after as and ofType', () => {
    expect(report('(Observation.value as Period).unit', observation)).toEqual([
      'error semantic/unknown-element',
    ]);
    expect(report('(Observation.value as Period).start', observation)).toEqual([]);
    expect(report('Observation.value.ofType(Quantity).unit', observation)).toEqual([]);
    expect(report('Observation.value.ofType(Quantity).start', observation)).toEqual([
      'error semantic/unknown-element',
    ]);
    // A FHIR primitive matches the System type it converts to in ofType(), and keeps its type.
    expect(report('name.given.ofType(System.String).length()', patient)).toEqual([]);
    expect(report('name.given.ofType(System.String).extension', patient)).toEqual([]);
    // On an input of unknown or abstract type, which primitives ofType() keeps cannot be told.
    expect(report('descendants().ofType(System.String).extension.url', patient)).toEqual([]);
    expect(report('descendants().ofType(System.String).foo', patient)).toEqual([]);
    expect(report('children().ofType(Element).ofType(System.Boolean).extension', patient)).toEqual(
      [],
    );
    expect(report('descendants().ofType(Period).unit', patient)).toEqual([
      'error semantic/unknown-element',
    ]);
    expect(report('descendants().ofType(System.String).extension')).toEqual([]);
    expect(report("(1 | 'a').ofType(System.String).extension", model)).toEqual([
      'error semantic/unknown-element',
    ]);
    // as keeps a FHIR primitive only for its own type, so this is empty and raises nothing.
    expect(report('(name.given.first() as System.String).extension', patient)).toEqual([]);
    expect(report("('a' as System.String).extension", patient)).toEqual([
      'error semantic/unknown-element',
    ]);
  });
});

describe('with a model', () => {
  it('reports an element the type does not have (testSimpleFail)', () => {
    expect(first('name.given1', patient)).toMatchObject({
      severity: 'error',
      code: 'semantic/unknown-element',
      message: 'HumanName has no element given1',
      span: { start: 0, end: 11 },
    });
    expect(report('Patient.name.given1', model)).toEqual(['error semantic/unknown-element']);
    expect(report('birthDate.value', patient)).toEqual(['error semantic/unknown-element']);
    expect(report("'abc'.foo", model)).toEqual(['error semantic/unknown-element']);
    expect(report('(1 | 2).foo', model)).toEqual(['error semantic/unknown-element']);
  });

  // Unary polarity and abs() convert a node to its System value first
  // ([N1 §6.6](https://hl7.org/fhirpath/N1/#math)): -Patient.telecom.rank is a System.Integer,
  // not a positiveInt, so a guard on the System type rules the other branch out, and a guard on
  // the model type never holds.
  it('infers the System value that unary polarity and abs() convert a node to', () => {
    const input = { resourceType: 'Patient', telecom: [{ rank: 1 }] };
    const values = [
      '(-Patient.telecom.rank)',
      '(+Patient.telecom.rank)',
      'Patient.telecom.rank.abs()',
    ];
    for (const value of values) {
      const guarded = `${value}.iif($this is System.Integer, true, $this.substring(0).exists())`;
      expect(report(guarded, patient)).toEqual([]);
      expect(evaluate(input, guarded, model)).toEqual([true]);
      const never = `${value}.iif($this is positiveInt, $this.substring(0), true)`;
      expect(report(never, patient)).toEqual([]);
      expect(evaluate(input, never, model)).toEqual([true]);
      expect(report(`${value}.substring(0)`, patient)).toEqual(['error semantic/type-mismatch']);
    }
    // A choice keeps the types the operation accepts; an open type may convert to anything.
    expect(report('(-Patient.multipleBirth).substring(0)', patient)).toEqual([
      'error semantic/type-mismatch',
    ]);
    expect(report('(-Patient.contained).substring(0)', patient)).toEqual([]);
    expect(report('Patient.contained.abs().substring(0)', patient)).toEqual([]);
    expect(report('(-value).substring(0)')).toEqual([]);
    // A Quantity becomes a System.Quantity, which has no elements, as at evaluation.
    expect(report('(-Observation.value.ofType(Quantity)).unit', observation)).toEqual([
      'error semantic/unknown-element',
    ]);
    expect(report("Observation.value.ofType(Quantity).abs() + 1 'mg'", observation)).toEqual([]);
    const literals =
      "(-(1 'mg')) is System.Quantity and (-1.5) is Decimal and (1).abs() is Integer";
    expect(report(literals)).toEqual([]);
    expect(evaluate(null, literals)).toEqual([true]);
  });

  // testPolymorphismAsA: without a model, Quantity is System.Quantity, which has no elements,
  // but the expression is written for a model, where it has.
  it('says nothing about elements without a model', () => {
    expect(report('(Observation.value as Quantity).unit')).toEqual([]);
    expect(report("'abc'.foo")).toEqual([]);
    expect(report("(5 'mg').unit.length()")).toEqual([]);
  });

  it('suggests the spec form for a choice element with its type suffix (testPolymorphismB)', () => {
    expect(first('Observation.valueQuantity.unit', observation)).toMatchObject({
      code: 'semantic/unknown-element',
      message: expect.stringContaining('value is a choice element'),
      hint: 'value.ofType(Quantity)',
    });
    expect(
      report('Observation.valueQuantity.unit', { ...observation, lenient: { choiceSuffix: true } }),
    ).toEqual([]);
    expect(
      report('Observation.valueString.length()', {
        ...observation,
        lenient: { choiceSuffix: true },
      }),
    ).toEqual([]);
    expect(
      report('Observation.valueFoo', { ...observation, lenient: { choiceSuffix: true } }),
    ).toEqual(['error semantic/unknown-element']);
    expect(first('Observation.valueFoo', observation)?.hint).toBeUndefined();
  });

  it('reports a leading type name that does not match the input (testSimpleWithWrongContext)', () => {
    expect(first('Observation.status', patient)).toMatchObject({
      code: 'semantic/type-mismatch',
      message: 'Observation does not match the input, which is a Patient',
    });
    expect(report('Patient.name', patient)).toEqual([]);
    expect(report('DomainResource.contained', patient)).toEqual([]);
    expect(report('Resource.id', patient)).toEqual([]);
    expect(report('HumanName.given', { model: stubModel, inputType: 'HumanName' })).toEqual([]);
    expect(report('Patient.name', { model: stubModel, inputType: 'HumanName' })).toEqual([
      'error semantic/type-mismatch',
    ]);
    // Inside a lambda the focus is the item, so a type name is checked against it.
    expect(report('name.where(Patient.active)', patient)).toEqual(['error semantic/type-mismatch']);
    expect(report('name.where(%context.active)', patient)).toEqual([]);
    // Without an input type, the name says what the input is.
    expect(report('Observation.status', model)).toEqual([]);
  });

  it('follows the model through abstract types, contained resources and primitives', () => {
    expect(report('contained.status', patient)).toEqual([]);
    expect(report('contained.ofType(Observation).status', patient)).toEqual([]);
    expect(report('contained.ofType(Observation).given', patient)).toEqual([
      'error semantic/unknown-element',
    ]);
    expect(report('birthDate.extension.url', patient)).toEqual([]);
    expect(report('name.given.extension.value.ofType(string)', patient)).toEqual([]);
    expect(report('managingOrganization.reference.length()', patient)).toEqual([]);
    expect(report('managingOrganization.reference.unit', patient)).toEqual([
      'error semantic/unknown-element',
    ]);
  });

  // An abstract type stands for its subtypes, which may be primitives: a FHIR boolean is an
  // Element, so ofType(Element) may keep one, and toString() then converts it.
  it('keeps the subtypes of an abstract type possible', () => {
    expect(report('children().ofType(Element).toString()', patient)).toEqual([]);
    expect(
      evaluate(
        { resourceType: 'Patient', active: true },
        'children().ofType(Element).toString()',
        model,
      ),
    ).toEqual(['true']);
    expect(report('children().ofType(Element).substring(0)', patient)).toEqual([]);
    expect(report('children().ofType(Element) + 1', patient)).toEqual([]);
    expect(report('children().ofType(Element).allTrue()', patient)).toEqual([]);
    expect(report('contained.toString()', patient)).toEqual([]);
    expect(report('1 + contained.first()', patient)).toEqual([]);
    // A concrete complex type stays complex, as do its subtypes.
    expect(report('name.toString()', patient)).toEqual(['error semantic/type-mismatch']);
    expect(report('children().ofType(HumanName).toString()', patient)).toEqual([
      'error semantic/type-mismatch',
    ]);
  });

  it('types the input by inputType, one type or several', () => {
    expect(report('start', { model: stubModel, inputType: 'Period' })).toEqual([]);
    expect(report('start', { model: stubModel, inputType: ['Period', 'Timing'] })).toEqual([]);
    expect(report('event', { model: stubModel, inputType: ['Period', 'Timing'] })).toEqual([]);
    expect(report('unit', { model: stubModel, inputType: ['Period', 'Timing'] })).toEqual([
      'error semantic/unknown-element',
    ]);
    expect(report('start', { model: stubModel, inputType: [] })).toEqual([]);
  });

  it('reports an input type the model does not have, without a span', () => {
    expect(first('status', { model: stubModel, inputType: 'DeviceAlert' })).toEqual({
      severity: 'error',
      code: 'semantic/unknown-type',
      message: 'The input type DeviceAlert is not defined in the model',
    });
    expect(report('status', { model: stubModel, inputType: ['Period', 'Nope'] })).toEqual([
      'error semantic/unknown-type',
    ]);
    expect(codeOf(() => compile('status', { model: stubModel, inputType: 'DeviceAlert' }))).toBe(
      'semantic/unknown-type',
    );
  });

  it('needs a model for inputType', () => {
    expect(codeOf(() => analyze('status', { inputType: 'Patient' }))).toBe('eval/invalid-argument');
    expect(codeOf(() => compile('status', { inputType: 'Patient' }))).toBe('eval/invalid-argument');
  });

  // isEffectOnLogic3Base: toString() takes a primitive. docs/spec-notes.md#conversion-functions-on-complex-values
  it('rejects a conversion of a complex value', () => {
    expect(
      first('$this.toString().length() > 10', { model: stubModel, inputType: 'Period' }),
    ).toMatchObject({
      code: 'semantic/type-mismatch',
      message: 'Expected a primitive value for the input of toString(), but found a Period',
    });
    expect(report('$this.toString()', { model: stubModel, inputType: 'dateTime' })).toEqual([]);
    expect(report('name.toString()', patient)).toEqual(['error semantic/type-mismatch']);
    expect(report('value.toString()', observation)).toEqual([]);
    expect(report('value.convertsToQuantity()', observation)).toEqual([]);
  });
});

// https://hl7.org/fhirpath/N1/#repeatprojection-expression-collection: the projection is also
// applied to every item it gives, so its focus may be of every type reachable that way.
describe('repeat()', () => {
  it('analyzes the projection with every type the walk reaches', () => {
    expect(report('Patient.repeat(name | given).ofType(System.String)', patient)).toEqual([]);
    expect(report('repeat(name | given | period).start', patient)).toEqual([]);
    expect(report('repeat(name | name.period | given)', patient)).toEqual([]);
    expect(report('contained.repeat(status)', patient)).toEqual([]);
    expect(report("name.repeat(given).where($this = 'Ada')", patient)).toEqual([]);
  });

  it('infers the types of what the walk gives', () => {
    expect(report('repeat(name | given).first().given', patient)).toEqual([]);
    expect(report('repeat(name).given.extension.url', patient)).toEqual([]);
    expect(report('repeat(name).foo', patient)).toEqual(['error semantic/unknown-element']);
    expect(report('repeat(name).given.foo', patient)).toEqual(['error semantic/unknown-element']);
    expect(report('repeat(name).toString()', patient)).toEqual(['error semantic/type-mismatch']);
  });

  it('reports an element that no reachable type has, once', () => {
    expect(report('repeat(nope)', patient)).toEqual(['error semantic/unknown-element']);
    // given is only reachable through a name, which this walk never gives.
    expect(report('repeat(name.period | given)', patient)).toEqual([
      'error semantic/unknown-element',
    ]);
    expect(report('repeat(name | nope)', patient)).toEqual(['error semantic/unknown-element']);
    expect(report('repeat(name | given).nope', patient)).toEqual([
      'error semantic/unknown-element',
    ]);
  });

  it('nests, and gives up the types of deep nests instead of multiplying the work', () => {
    expect(report('repeat(repeat(name | given)).foo', patient)).toEqual([
      'error semantic/unknown-element',
    ]);
    expect(report('repeat(repeat(name | given)).family', patient)).toEqual([]);
    // Each repeat() analyzes its projection once per pass; 30 nested would be 2^30 visits.
    const nested = `iif(false, 1.${'repeat('.repeat(30)}$this${')'.repeat(30)}, 0)`;
    expect(report(nested)).toEqual([]);
    expect(evaluate(null, nested)).toEqual([0]);
    expect(report(`name.${'repeat('.repeat(30)}given${')'.repeat(30)}.nope`, patient)).toEqual([]);
  });

  it('knows nothing when the input or the walk is unknown', () => {
    expect(report('repeat(name).foo')).toEqual([]);
    expect(report('repeat(%v).foo', patient)).toEqual([]);
    expect(report('repeat(nope).foo', model)).toEqual([]);
  });
});

// The HL7 suite's isSemanticChecks group: docs/spec-notes.md#type-guards
describe('type guards', () => {
  const period: CompileOptions = { model: stubModel, inputType: 'Period' };
  const periodOrTiming: CompileOptions = { model: stubModel, inputType: ['Period', 'Timing'] };
  const periodOrDateTime: CompileOptions = { model: stubModel, inputType: ['Period', 'dateTime'] };
  const check = '$this.toString().length() >= 10';

  it.each<[string, CompileOptions]>([
    [`$this is dateTime implies ${check}`, period],
    [`$this.is(dateTime) implies ${check}`, period],
    [`$this is dateTime implies ${check}`, periodOrTiming],
    [`($this is dateTime or $this is instant) implies ${check}`, period],
    [
      `($this is dateTime or $this is Period) implies ${check}`,
      { model: stubModel, inputType: 'dateTime' },
    ],
    [`($this is dateTime and %resource.status = 'final') implies ${check}`, period],
    [`(%resource.status = 'final' and $this is dateTime) implies ${check}`, period],
    [`$this is Period or (%resource.status = 'final' implies ${check})`, period],
    [`$this is dateTime and ${check}`, period],
    [`$this is Period or ${check}`, period],
    [`$this is Period or ${check}`, periodOrDateTime],
    [`$this is Period or $this is Timing or ${check}`, periodOrTiming],
    [`$this is dateTime xor ${check}`, periodOrDateTime],
    [`($this is Period).not() implies ${check}`, period],
    [`iif($this is dateTime, ${check}, true)`, period],
    [`iif($this is Period, true, ${check})`, period],
    [`$this is Period implies ($this is dateTime implies ${check})`, periodOrTiming],
    [`$this.ofType(dateTime).toString().length() >= 10`, period],
    [`($this as dateTime).toString().length() >= 10`, period],
    [`$this.where($this is dateTime).toString()`, periodOrDateTime],
  ])('accepts %s', (expression, options) => {
    expect(report(expression, options)).toEqual([]);
  });

  it.each<[string, CompileOptions]>([
    [check, period],
    [`$this.is(Period) implies ${check}`, periodOrTiming],
    [`$this is Period implies ${check}`, periodOrTiming],
    [`($this is dateTime or $this is Period) implies ${check}`, period],
    [`($this.is(dateTime) or $this.is(Period)) implies ${check}`, period],
    [`($this is dateTime or %resource.status = 'final') implies ${check}`, period],
    [`$this is dateTime or %resource.status = 'final' implies ${check}`, period],
    [`$this is Period or (%resource.status = 'final' implies ${check})`, periodOrTiming],
    [`$this is Period and ${check}`, periodOrTiming],
    [`$this is Period or ${check}`, periodOrTiming],
    [`$this is dateTime xor ${check}`, period],
    [`($this is Period).not() implies ${check}`, periodOrTiming],
    [`iif($this is Period, ${check}, true)`, period],
    [`$this is Element implies ${check}`, period],
    [`$this.start is dateTime implies ${check}`, period],
  ])('rejects %s', (expression, options) => {
    expect(report(expression, options)).toEqual(['error semantic/type-mismatch']);
  });

  it('bounds the constraints of long chains, and keeps what they say', () => {
    // and keeps every constraint, or one per pair: 2, 4, 8, … without coalescing.
    const clause = '($this is Integer and $this is Integer)';
    const chain = `${Array(30).fill(clause).join(' or ')} implies true`;
    expect(report(chain)).toEqual([]);
    expect(evaluate(1, chain)).toEqual([true]);
    expect(report(`${Array(30).fill(clause).join(' or ')} implies $this.substring(0)`)).toEqual([
      'error semantic/type-mismatch',
    ]);
    const pair = (a: string, b: string) =>
      `(($this is ${a} and $this is ${a}) or ($this is ${b} and $this is ${b}))`;
    expect(report(`${pair('dateTime', 'instant')} implies ${check}`, period)).toEqual([]);
    expect(report(`${pair('Period', 'Timing')} implies ${check}`, periodOrTiming)).toEqual([
      'error semantic/type-mismatch',
    ]);
    // Many distinct clauses: the union of them all, still enough to rule a Period out.
    const many = [
      'dateTime',
      'instant',
      'string',
      'code',
      'boolean',
      'integer',
      'decimal',
      'uri',
      'id',
      'date',
    ]
      .map((type) => `($this is ${type} and $this is ${type})`)
      .join(' or ');
    expect(report(`${many} implies ${check}`, period)).toEqual([]);
    expect(report(`${many} or $this is Period implies ${check}`, period)).toEqual([
      'error semantic/type-mismatch',
    ]);
  });

  it('names paths without collisions between delimited and nested names', () => {
    // One property named a.b, and the path a then b: the guard is on the first only.
    expect(report('(`a.b` is Integer) implies a.b.substring(0).exists()')).toEqual([]);
    expect(report('(a.b is Integer) implies `a.b`.substring(0).exists()')).toEqual([]);
    expect(report('(%`v.x` is Integer) implies %v.x.substring(0).exists()')).toEqual([]);
    expect(report('(%v.x is Integer) implies %`v.x`.substring(0).exists()')).toEqual([]);
    expect(
      evaluate(
        { 'a.b': 1, a: { b: 'ok' } },
        '(`a.b` is Integer) implies a.b.substring(0).exists()',
      ),
    ).toEqual([true]);
    // The same path on both sides: the guard applies.
    expect(report('(a.b is Integer) implies a.b.substring(0).exists()')).toEqual([
      'error semantic/type-mismatch',
    ]);
    expect(report('(%v.x is Integer) implies %v.x.substring(0).exists()')).toEqual([
      'error semantic/type-mismatch',
    ]);
  });

  it('narrows a path, a variable and the focus of a lambda', () => {
    expect(report('value is Quantity implies value.unit.length() > 0', observation)).toEqual([]);
    expect(report('value is Quantity implies value.start', observation)).toEqual([
      'error semantic/unknown-element',
    ]);
    expect(report('%v is Period implies %v.start.length()', model)).toEqual([
      'error semantic/type-mismatch',
    ]);
    expect(report('%v is Period implies %v.start', model)).toEqual([]);
    expect(report('%v is Period implies %v.unit', model)).toEqual([
      'error semantic/unknown-element',
    ]);
    expect(report('value.where($this is Period).start', observation)).toEqual([]);
    expect(report("value.select(iif($this is Period, start, 'x'))", observation)).toEqual([]);
    // A guard on the outer $this does not reach a lambda, whose $this is its own item.
    expect(
      report('$this is Timing implies event.where($this.start).exists()', periodOrTiming),
    ).toEqual(['error semantic/unknown-element']);
    expect(
      report('$this is Timing implies event.where($this > @2020).exists()', periodOrTiming),
    ).toEqual([]);
  });
});

// https://hl7.org/fhirpath/N1/#type-safety-and-strict-evaluation
describe('strict mode', () => {
  const strict: CompileOptions = { ...patient, strict: true };

  it.each([
    "name.given < 'X'",
    'name.given.substring(1)',
    "name.given + 'x'",
    "name.given & 'x'",
    '-telecom.rank',
    'name.given.toString()',
    'name.given.is(string)',
    'name.given as string',
    'name.given.iif(true, 1)',
    'name[telecom.rank]',
    "name.given in 'a'",
    "'a' contains name.given",
    'name.skip(telecom.rank)',
    'name.where(given.exists() | true)',
  ])('rejects %s, where a single item is expected', (expression) => {
    expect(report(expression, strict)).toEqual(['error semantic/singleton-expected']);
    expect(report(expression, patient)).toEqual([]);
  });

  it('reports the cardinality and the type of an operand', () => {
    expect(report('name.given.not()', strict)).toEqual([
      'error semantic/type-mismatch',
      'error semantic/singleton-expected',
    ]);
    expect(report('name.given and true', strict)).toEqual([
      'error semantic/type-mismatch',
      'error semantic/singleton-expected',
    ]);
  });

  // The equality example of N1 §11, and the two forms the spec suggests instead.
  it('reports equality between a single item and a collection, not between two collections', () => {
    expect(report("name.given = 'Wouter'", strict)).toEqual(['error semantic/singleton-expected']);
    expect(report("'Wouter' != name.given", strict)).toEqual(['error semantic/singleton-expected']);
    expect(report('name = name', strict)).toEqual([]);
    expect(report("name.given.first() = 'Wouter'", strict)).toEqual([]);
    expect(report("name.exists(given.first() = 'Wouter')", strict)).toEqual([]);
    expect(report("'Wouter' in name.given", strict)).toEqual([]);
    // given repeats, so the spec's own where() example is still unsafe by its definition.
    expect(report("name.where(given = 'Wouter').exists()", strict)).toEqual([
      'error semantic/singleton-expected',
    ]);
  });

  it('reports equality between types that are never equal', () => {
    expect(report("active = 'true'", strict)).toEqual(['error semantic/type-mismatch']);
    expect(report("1 = 'a'", { strict: true })).toEqual(['error semantic/type-mismatch']);
    expect(report('birthDate = @1974', strict)).toEqual([]);
    expect(report('birthDate = @1974-12-25T00:00', strict)).toEqual([]);
    expect(report("gender = 'male'", strict)).toEqual([]);
    expect(report('value = 5', observation)).toEqual([]);
    expect(report("1 = 1 '1'", { strict: true })).toEqual([]);
    expect(report('name = telecom', strict)).toEqual([]);
  });

  it('never reports a value whose cardinality or type is unknown', () => {
    expect(report("name.given < 'X'", { strict: true })).toEqual([]);
    expect(report("%v = 'a'", { strict: true })).toEqual([]);
    expect(report('active = true', { ...model, strict: true })).toEqual([]);
    expect(report('contained.status = true', strict)).toEqual([]);
  });

  it('knows which results have one item', () => {
    for (const expression of [
      'name.count() > 1',
      'name.given.first().length()',
      'name.given.single().length()',
      'name.given.last().length()',
      'name.given[0].length()',
      'name.exists() and active',
      'name.given.distinct().count()',
      "name.select(given.first() + ' ' + family)",
      'iif(active, name.first(), name.last()).family.length()',
      '(name.given.first() | {}).length()',
      'active.where($this).not()',
    ]) {
      expect(report(expression, strict)).toEqual([]);
    }
    expect(report('name.given.tail().length()', strict)).toEqual([
      'error semantic/singleton-expected',
    ]);
    expect(report('name.select(given).length()', strict)).toEqual([
      'error semantic/singleton-expected',
    ]);
    expect(report("iif(active, name.given, 'x').length()", strict)).toEqual([
      'error semantic/singleton-expected',
    ]);
    expect(report("(name.given.first() | 'x').length()", strict)).toEqual([
      'error semantic/singleton-expected',
    ]);
    expect(report('name.given.repeat($this).length()', strict)).toEqual([
      'error semantic/singleton-expected',
    ]);
  });

  // https://hl7.org/fhirpath/N1/#collections (#72, testDollarOrderNotAllowed)
  it.each([
    'children().skip(1)',
    'children().take(1)',
    'children().first()',
    'children().last()',
    'children().tail()',
    'children()[0]',
    'descendants().first()',
    'repeat(children()).first()',
    'repeat(descendants()).first()',
    'repeat(children()).where(true).first()',
    'children().select(id).first()',
    'name.children().where(true).first()',
    'children().distinct().first()',
    "children().trace('x').first()",
    'children().ofType(HumanName).first()',
    '(children() | name).first()',
  ])('rejects %s: the order is undefined', (expression) => {
    expect(report(expression, strict)).toEqual(['error semantic/unordered-collection']);
    expect(report(expression, patient)).toEqual([]);
  });

  it('accepts what does not depend on the order', () => {
    for (const expression of [
      'children().count()',
      'children().where($this is HumanName).given',
      'children().select(id.first())',
      'repeat(name).first()',
      'repeat(children()).count()',
      'children().single()',
      'children().exists()',
      'descendants().ofType(string).distinct()',
      'name.first().children()',
    ]) {
      expect(report(expression, strict)).toEqual([]);
    }
  });

  // A value that can have no item is empty, so nothing about it is unsafe.
  it('exempts a value that can have no item', () => {
    for (const expression of [
      '(1 | 2).ofType(System.String).length()',
      '(1 | 2).select({}).length()',
      '(1 | 2).ofType(System.String) = 1',
      "name.ofType(Period).start = 'x'",
      'name.given.select({}).first().length()',
      // Equality with an empty operand is empty, whatever the other operand is.
      '(1 | 2) = {}',
      '{} = (1 | 2)',
      '(1 | 2) ~ {}',
      '{} !~ (1 | 2)',
      '(1 | 2) != (1 | 2).ofType(System.String)',
      '(1 | 2).ofType(System.String) ~ name.given',
      'name.given = {}',
      '{} = name.given',
    ]) {
      expect(report(expression, strict)).toEqual([]);
    }
    expect(report('(1 | 2) = 1', strict)).toEqual(['error semantic/singleton-expected']);
  });

  it('keeps the unknown-type and fraction warnings', () => {
    expect(report('gender.is(string1)', strict)).toEqual(['warning semantic/unknown-type']);
    expect(report('@2020 + 1.5 years', strict)).toEqual(['warning semantic/fraction-ignored']);
    expect(evaluate(null, '@2020 + 1.5 years', { strict: true })).toEqual(['2021']);
  });
});

// https://hl7.org/fhirpath/STU3/#datetime-arithmetic: "Implementers SHOULD produce a warning
// when decimal fractions are ignored"; docs/spec-notes.md#fractions-in-datetime-arithmetic
describe('the fraction warning', () => {
  it.each([
    ['@1973-12-25 + 7.7 days', '1974-01-01'], // testPlusDate2
    ['@T10:00 + 1.5 hours', '11:00'],
    ['@2014 + 23 months', '2015'],
    ['@2014 - 23 months', '2013'],
    ['@T10:00:00 + 0.5 seconds', '10:00:00'],
    ["@2020-01-01 - -1.5 'd'", '2020-01-02'],
    ["@2020-01-01T00:00:00.000 + 1.5 'ms'", '2020-01-01T00:00:00.001'],
  ])('warns about %s, which evaluates as before', (expression, result) => {
    expect(first(expression)).toMatchObject({
      severity: 'warning',
      code: 'semantic/fraction-ignored',
      span: { start: 0 },
    });
    expect(report(expression, { strict: true })).toEqual(['warning semantic/fraction-ignored']);
    expect(evaluate(null, expression)).toEqual([result]);
    expect(evaluate(null, expression, { strict: true })).toEqual([result]);
  });

  it('warns when the left operand is a date/time by its type, not only a literal', () => {
    expect(report('today() - 7.7 days')).toEqual(['warning semantic/fraction-ignored']);
    expect(report('now() + 1.5 hours')).toEqual(['warning semantic/fraction-ignored']);
    expect(report('birthDate + 1.5 days', patient)).toEqual(['warning semantic/fraction-ignored']);
    expect(report('(birthDate + 1 day) + 1.5 days', patient)).toEqual([
      'warning semantic/fraction-ignored',
    ]);
    expect(report('issued + 1.5 hours', observation)).toEqual([
      'warning semantic/fraction-ignored',
    ]);
  });

  it.each([
    '@1973-12-25 + 7 days',
    "@1973-12-25T00:00:00.000+10:00 + 0.1 's'", // testPlusDate19
    '@2014 + 24 months',
    '@2014 + 1 year',
    '@T10:00:00.000 + 0.5 seconds',
    'birthDate + 7.7 days', // model-less: the type of the left operand is unknown
    '%d + 7.7 days',
    '@2020 + %q',
    "@2020 + 7.7 'mg'.toQuantity('d')",
    '7.7 days + @2020',
  ])('does not warn about %s', (expression) => {
    expect(report(expression).filter((entry) => entry.includes('fraction'))).toEqual([]);
  });

  it('does not warn about a quantity from the data, which only evaluation sees', () => {
    expect(report('birthDate + value', { ...patient })).toEqual(['error semantic/unknown-element']);
    expect(report('issued + %q', observation)).toEqual([]);
    expect(report('effective + value', observation)).toEqual([]);
  });

  it('says what is ignored', () => {
    expect(first('@2014 + 23 months')?.message).toBe(
      'Date/time arithmetic ignores part of 23 months: it is finer than the precision of @2014',
    );
    expect(first('today() - 7.7 days')?.message).toContain('the fraction of 7.7 days');
  });
});

describe('compile()', () => {
  it('throws the first error with every diagnostic attached', () => {
    try {
      compile('foo() | (@2020 + 1.5 days) | baz()', { strict: false });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: 'semantic/unknown-function',
        span: { start: 0 },
        expression: 'foo() | (@2020 + 1.5 days) | baz()',
      });
      expect((error as { diagnostics: Diagnostic[] }).diagnostics.map((d) => d.code)).toEqual([
        'semantic/unknown-function',
        'semantic/fraction-ignored',
        'semantic/unknown-function',
      ]);
    }
  });

  it('compiles an expression with warnings only', () => {
    expect(compile('@2020-01-01 + 1.5 days').evaluate(null)).toEqual(['2020-01-02']);
    expect(compile('Patient.gender.as(string1)', model).expression).toBe(
      'Patient.gender.as(string1)',
    );
  });
});
