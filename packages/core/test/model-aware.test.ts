/**
 * End-to-end tests of model-aware evaluation through the internal API, with the mini FHIR model
 * ([T0018 acceptance criteria](../../../docs/tasks/T0018-model-aware-evaluation.md#acceptance-criteria)).
 * `ofType()` (T0042), `children()` (T0017) and `hasValue()` (T0020) are not registered yet; the
 * matching rule of `ofType()` and the children helper are covered in the runtime tests.
 */
import { describe, expect, it } from 'vitest';
import {
  type CompileOptions,
  compile,
  type EvaluateOptions,
  evaluate,
} from '../src/api/compile.ts';
import { FhirPathError } from '../src/errors/fhirpath-error.ts';
import { JsonNumber, parseJson } from '../src/model/lossless-json.ts';
import { ModelNode } from '../src/model/model-node.ts';
import { DateValue } from '../src/values/datetime/date.ts';
import { DateTimeValue } from '../src/values/datetime/datetime.ts';
import { Decimal } from '../src/values/decimal/decimal.ts';
import { Quantity } from '../src/values/quantity/quantity.ts';
import { stubModel, stubType } from './support/stub-model.ts';

const syllables = { url: 'https://example.org/syllable-count', valueString: 'five' };
const birthTime = {
  url: 'http://hl7.org/fhir/StructureDefinition/patient-birthTime',
  valueDateTime: '1974-12-25T14:35:45-05:00',
};

const patient = {
  resourceType: 'Patient',
  id: 'p1',
  active: true,
  name: [
    { use: 'official', given: ['Peter', 'James'], family: 'Chalmers' },
    { use: 'maiden', given: ['a', null], _given: [null, { extension: [syllables] }] },
  ],
  telecom: [{ use: 'home' }, { use: 'work' }],
  gender: 'male',
  birthDate: '1974-12-25',
  _birthDate: { extension: [birthTime] },
  deceasedBoolean: false,
  contained: [
    { resourceType: 'Observation', status: 'final' },
    { resourceType: 'Foo', x: 1 },
  ],
};

const observation = {
  resourceType: 'Observation',
  status: 'final',
  issued: '2016-03-28T10:30:00Z',
  effectivePeriod: { start: '2016-03-28' },
  valueQuantity: { value: 185, unit: 'lbs', system: 'http://unitsofmeasure.org', code: '[lb_av]' },
};

type Options = CompileOptions & EvaluateOptions;

function run(input: unknown, expression: string, options: Options = {}): unknown[] {
  return evaluate(input, expression, { model: stubModel, ...options });
}

function typed(input: unknown, expression: string, options: Options = {}): unknown[] {
  return run(input, expression, { ...options, output: 'typed' });
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

// https://hl7.org/fhir/R5/fhirpath.html#polymorphism
describe('choice elements', () => {
  it.each<[string, unknown[]]>([
    ['Observation.value.unit', ['lbs']],
    ['Observation.value.as(Quantity).unit', ['lbs']],
    ['(Observation.value as Quantity).unit', ['lbs']],
    ['Observation.value.is(Quantity)', [true]],
    ['Observation.value is Quantity', [true]],
    ['Observation.value.is(Period).not()', [true]],
    ['Observation.value.as(Period).start', []],
    ['Observation.value.exists()', [true]],
    ['Observation.effective is Period', [true]],
    ['Observation.effective.start', ['2016-03-28']],
    ['Observation.issued is instant', [true]],
    ['Observation.issued is dateTime', [false]],
  ])('%s', (expression, expected) => {
    expect(run(observation, expression)).toEqual(expected);
  });

  // ADR-0012: the suffix form is not an element; empty at runtime, a semantic error with T0024.
  it.each(['Observation.valueQuantity', 'Observation.valueQuantity.unit'])(
    '%s is empty by default',
    (expression) => {
      expect(run(observation, expression)).toEqual([]);
    },
  );

  it('accepts the type suffix with lenient.choiceSuffix', () => {
    const lenient: Options = { lenient: { choiceSuffix: true } };
    expect(run(observation, 'Observation.valueQuantity.unit', lenient)).toEqual(['lbs']);
    expect(run(observation, 'Observation.valueQuantity.exists()', lenient)).toEqual([true]);
    expect(run(observation, 'Observation.valueString.exists()', lenient)).toEqual([false]);
    expect(run(observation, 'Observation.value.unit', lenient)).toEqual(['lbs']);
    expect(run(observation, 'Observation.valueQuantity', { lenient: {} })).toEqual([]);
  });

  it('converts a Quantity with a UCUM code to a System.Quantity', () => {
    const [value] = typed(observation, 'Observation.value');
    expect(value).toBeInstanceOf(ModelNode);
    expect((value as ModelNode).systemValue()).toBeInstanceOf(Quantity);
    expect(run(observation, "Observation.value = 185 '[lb_av]'")).toEqual([true]);
    expect(run(observation, "Observation.value > 100 '[lb_av]'")).toEqual([true]);
    expect(run(observation, 'Observation.value.value = 185')).toEqual([true]);
  });
});

// https://hl7.org/fhir/R5/fhirpath.html#types, docs/spec-notes.md#fhir-primitives-in-is-as-and-oftype
describe('FHIR primitives', () => {
  it.each<[string, unknown[]]>([
    ['Patient.birthDate is date', [true]],
    ['Patient.birthDate is System.Date', [false]],
    ['Patient.birthDate is dateTime', [false]],
    ['Patient.birthDate = @1974-12-25', [true]],
    ['Patient.birthDate < @1975', [true]],
    ['Patient.birthDate = @1974-12', []],
    ['Patient.active is boolean', [true]],
    ['Patient.active is Boolean', [false]],
    ['Patient.active and true', [true]],
    ['Patient.gender.is(code)', [true]],
    ['Patient.gender.is(string)', [true]],
    ['Patient.gender.is(id)', [false]],
    ['Patient.gender.as(code)', ['male']],
    ['Patient.gender.as(string)', ['male']], // the contested testFHIRPathAsFunction11
    ['Patient.gender.as(id)', []],
    ["Patient.gender = 'male'", [true]],
    ['Patient.telecom.use', ['home', 'work']],
    ["Patient.name.where(use = 'official').given", ['Peter', 'James']],
  ])('%s', (expression, expected) => {
    expect(run(patient, expression)).toEqual(expected);
  });

  it('gives typed values in typed output', () => {
    const [birthDate] = typed(patient, 'Patient.birthDate');
    expect(birthDate).toBeInstanceOf(ModelNode);
    expect((birthDate as ModelNode).type).toBe(stubType('date'));
    expect((birthDate as ModelNode).systemValue()).toBeInstanceOf(DateValue);
    expect(typed(observation, 'Observation.issued')[0]).toBeInstanceOf(ModelNode);
    expect((typed(observation, 'Observation.issued')[0] as ModelNode).systemValue()).toBeInstanceOf(
      DateTimeValue,
    );
  });

  it('keeps the JSON value in plain output', () => {
    expect(run(patient, 'Patient.birthDate')).toEqual(['1974-12-25']);
    expect(run(observation, 'Observation.value')).toEqual([observation.valueQuantity]);
  });
});

// https://hl7.org/fhir/R4/json.html#primitive
describe('primitive extensions', () => {
  it('gives one node per given, including one that only has extensions', () => {
    const given = typed(patient, 'Patient.name[1].given');
    expect(given).toHaveLength(2);
    const [first, second] = given as ModelNode[];
    expect(first).toMatchObject({ value: 'a', index: 0, primitiveElement: undefined });
    expect(second).toMatchObject({ value: undefined, index: 1 });
    expect(second?.primitiveElement).toEqual({ extension: [syllables] });
    // T0020's hasValue() is false for the second node; its System value is already empty.
    expect(second?.systemValue()).toBeUndefined();
    expect(run(patient, 'Patient.name[1].given.count()')).toEqual([2]);
    expect(run(patient, 'Patient.name[1].given')).toEqual(['a', { extension: [syllables] }]);
  });

  it('treats an extension-only primitive as empty in System operations', () => {
    expect(run(patient, "Patient.name[1].given[1] = 'a'")).toEqual([]);
    expect(run(patient, "Patient.name[1].given[1] ~ 'a'")).toEqual([false]);
    expect(run(patient, 'Patient.name[1].given[1] is string')).toEqual([true]);
    expect(run(patient, "Patient.name[1].given.where($this = 'a')")).toEqual(['a']);
  });

  // A FHIR primitive with only extensions has no value: empty in System operations, present as a node.
  it('behaves as empty in Boolean and Integer contexts, while it exists and has extensions', () => {
    const missing = { url: 'http://example.org/missing', valueString: 'unknown' };
    const input = {
      resourceType: 'Patient',
      _active: { extension: [missing] },
      _multipleBirthInteger: { extension: [missing] },
      name: [{ given: ['a', 'b'] }],
    };
    expect(run(input, 'Patient.active')).toEqual([{ extension: [missing] }]);
    expect(run(input, 'Patient.active.exists()')).toEqual([true]);
    expect(run(input, 'Patient.active.count()')).toEqual([1]);
    expect(run(input, 'Patient.active.extension.value')).toEqual(['unknown']);
    expect(run(input, 'Patient.active is boolean')).toEqual([true]);
    expect(run(input, 'Patient.active and true')).toEqual([]);
    expect(run(input, 'Patient.active or false')).toEqual([]);
    expect(run(input, 'Patient.active implies false')).toEqual([]);
    expect(run(input, 'Patient.active.not()')).toEqual([]);
    expect(run(input, 'Patient.active = true')).toEqual([]);
    expect(run(input, 'Patient.name.where(Patient.active).given')).toEqual([]);
    expect(run(input, 'Patient.name.exists(Patient.active)')).toEqual([false]);
    expect(run(input, 'Patient.name.given[Patient.multipleBirth]')).toEqual([]);
    expect(run(input, '-Patient.multipleBirth')).toEqual([]);
    expect(run(input, 'Patient.multipleBirth + 1')).toEqual([]);
  });

  it('navigates the extensions of a primitive', () => {
    expect(run(patient, 'Patient.birthDate.extension.url')).toEqual([birthTime.url]);
    expect(run(patient, 'Patient.birthDate.extension.value')).toEqual([birthTime.valueDateTime]);
    expect(run(patient, 'Patient.birthDate.extension.value is dateTime')).toEqual([true]);
    expect(run(patient, 'Patient.birthDate.extension.value = @1974-12-25T14:35:45-05:00')).toEqual([
      true,
    ]);
    expect(run(patient, 'Patient.name.given.extension.value')).toEqual(['five']);
    expect(run(patient, 'Patient.name.family.extension')).toEqual([]);
  });
});

// https://hl7.org/fhirpath/N1/#models, https://hl7.org/fhir/R5/fhirpath.html#rules
describe('the root identifier as a type', () => {
  it.each<[string, unknown[]]>([
    ['Patient.id', ['p1']],
    ['DomainResource.id', ['p1']],
    ['Resource.id', ['p1']],
    ['Observation.id', []],
    ['HumanName.given', []],
    ['Encounter.id', []], // not a type of the model: an ordinary path, which the data lacks
    ['id', ['p1']],
    ['Patient.contained.count()', [2]],
    ['Patient.contained[0] is Observation', [true]],
    ['Patient.contained[0].status', ['final']],
    ['Patient.contained[1] is Resource', [true]],
    ['Patient.contained[1] is Patient', [false]],
    ['Patient.contained.where($this is Observation).status', ['final']],
    ['Patient.contained.where($this is DomainResource).count()', [1]],
  ])('%s', (expression, expected) => {
    expect(run(patient, expression)).toEqual(expected);
  });

  it('matches each item of the focus by its own type', () => {
    expect(run([patient, observation], 'Patient.id')).toEqual(['p1']);
    expect(run([patient, observation], 'Observation.status')).toEqual(['final']);
    expect(run([patient, observation], 'DomainResource.id')).toEqual(['p1']);
  });

  it('types the input of a context expression', () => {
    const names = typed(patient, 'Patient.name');
    expect(run(names, 'HumanName.given')).toEqual([
      'Peter',
      'James',
      'a',
      { extension: [syllables] },
    ]);
    expect(run(names[0], 'given')).toEqual(['Peter', 'James']);
    expect(run(names[0], 'Patient.given')).toEqual([]);
  });
});

// docs/spec-notes.md#unresolved-type-specifiers-are-execution-errors
describe('type specifiers with a model', () => {
  it.each([
    'Patient.gender is string1',
    'Patient.gender.is(string1)',
    'Patient.gender as string1',
    'Patient.gender.as(string1)',
    'Patient.is(System.Patient)',
    'Patient is System.Patient',
    'Patient.active is FHIR.Boolean',
    'Patient.active.as(FHIR.Boolean)',
    'Patient is Foo.Patient',
    'Patient.as(Foo.Patient)',
    '{} is string1',
  ])('%s raises eval/unknown-type', (expression) => {
    expect(codeOf(() => run(patient, expression))).toBe('eval/unknown-type');
  });

  it('keeps the error timing: compilation succeeds, evaluation raises', () => {
    const compiled = compile('Patient.gender is string1', { model: stubModel });
    expect(codeOf(() => compiled.evaluate(patient))).toBe('eval/unknown-type');
    expect(codeOf(() => compiled.evaluate({}))).toBe('eval/unknown-type');
  });

  it.each<[string, unknown[]]>([
    ['Patient is Observation', [false]],
    ['Patient.as(Observation)', []],
    ['Patient.gender is id', [false]],
    ['Patient.gender as id', []],
    ['Patient is FHIR.Patient', [true]],
    ['Patient is System.Any', [true]],
    ['Patient.active is Any', [true]],
    ['Patient.name[0].as(HumanName).use', ['official']],
  ])('resolves %s to an ordinary match or mismatch', (expression, expected) => {
    expect(run(patient, expression)).toEqual(expected);
  });

  // testFHIRPathAsFunction21: as() on a repeating element is an execution error.
  it('raises eval/singleton-expected for several items', () => {
    expect(codeOf(() => run(patient, 'Patient.name.as(HumanName).use'))).toBe(
      'eval/singleton-expected',
    );
    expect(codeOf(() => run(patient, 'Patient.name is HumanName'))).toBe('eval/singleton-expected');
  });

  // https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md#resource-type-names-without-a-model
  it('does not fall back to the resourceType of an object the model does not know', () => {
    const unknown = { resourceType: 'Foo', name: [{ given: ['x'] }] };
    expect(codeOf(() => run(unknown, '$this is Foo'))).toBe('eval/unknown-type');
    expect(run(unknown, '$this is Patient')).toEqual([false]);
    expect(run(unknown, '$this is DomainResource')).toEqual([false]);
    expect(run(unknown, 'Foo.name.given')).toEqual([]);
    expect(run(unknown, 'name.given')).toEqual(['x']);
    expect(run(patient, 'Patient.contained[1].x')).toEqual([]);
    // Without a model, the same data matches its own name.
    expect(evaluate(unknown, '$this is Foo')).toEqual([true]);
    expect(evaluate(unknown, 'Foo.name.given')).toEqual(['x']);
  });
});

// docs/tasks/T0018-model-aware-evaluation.md#lossless-decimals-in-json-input
describe('lossless JSON input', () => {
  const text = JSON.stringify(observation).replace('185', '185.50');
  const lossless = parseJson(text);

  it('keeps the precision of a decimal end to end', () => {
    const [value] = typed(lossless, 'Observation.value.value');
    expect(value).toBeInstanceOf(ModelNode);
    expect((value as ModelNode).value).toBeInstanceOf(JsonNumber);
    expect(String((value as ModelNode).systemValue())).toBe('185.50');
    expect(run(lossless, 'Observation.value.value', { decimalOutput: 'string' })).toEqual([
      '185.50',
    ]);
    expect(run(lossless, 'Observation.value.value')).toEqual([185.5]);
    expect(run(lossless, 'Observation.value.value = 185.5')).toEqual([true]);
    expect(run(lossless, 'Observation.value.value ~ 185.50')).toEqual([true]);
    expect(run(lossless, "Observation.value = 185.50 '[lb_av]'")).toEqual([true]);
  });

  it('works without a model too', () => {
    expect(evaluate(lossless, 'valueQuantity.value', { decimalOutput: 'string' })).toEqual([
      '185.50',
    ]);
    expect(evaluate(lossless, 'valueQuantity.value.is(Decimal)')).toEqual([true]);
    expect(evaluate(parseJson('{"n": 185}'), 'n.is(Integer)')).toEqual([true]);
  });

  it('is lost with JSON.parse, as documented', () => {
    // Plain output gives the JSON value of a node; the typed Decimal shows the lost digit.
    expect(run(JSON.parse(text), 'Observation.value.value', { decimalOutput: 'string' })).toEqual([
      185.5,
    ]);
    const [value] = typed(JSON.parse(text), 'Observation.value.value');
    expect(String((value as ModelNode).systemValue())).toBe('185.5');
  });
});

describe('variables and compiled expressions', () => {
  it('types variables by the model', () => {
    const variables = { obs: observation, name: { given: ['x'] } };
    expect(run(patient, '%obs.value.unit', { variables })).toEqual(['lbs']);
    expect(run(patient, '%obs is Observation', { variables })).toEqual([true]);
    expect(run(patient, '%name.given', { variables })).toEqual(['x']);
    expect(run(patient, '%name is HumanName', { variables })).toEqual([false]);
  });

  it('compiles once and evaluates typed input of either kind', () => {
    const compiled = compile('Patient.birthDate < @2000', { model: stubModel });
    expect(compiled.evaluate(patient)).toEqual([true]);
    expect(compiled.evaluate(observation)).toEqual([]);
    expect(compiled.evaluate({ resourceType: 'Patient', birthDate: '2010' })).toEqual([false]);
  });

  // https://hl7.org/fhirpath/N1/#equals, https://hl7.org/fhirpath/N1/#union-collections
  it('never equates resources of different types, so a union keeps both', () => {
    const variables = {
      a: { resourceType: 'Patient', id: 'x' },
      b: { resourceType: 'Observation', id: 'x' },
      c: { resourceType: 'Patient', id: 'x' },
    };
    expect(run(patient, '%a = %b', { variables })).toEqual([false]);
    expect(run(patient, '%a ~ %b', { variables })).toEqual([false]);
    expect(run(patient, '%a = %c', { variables })).toEqual([true]);
    expect(run(patient, '(%a | %b).count()', { variables })).toEqual([2]);
    expect(run(patient, '(%a | %c).count()', { variables })).toEqual([1]);
    expect(run(patient, '%a in %b', { variables })).toEqual([false]);
  });

  it('never equates differently typed elements that share one JSON object', () => {
    const shared = { id: 'x' };
    const input = { resourceType: 'Patient', contact: [{ name: shared, period: shared }] };
    expect(run(input, 'Patient.contact.name = Patient.contact.period')).toEqual([false]);
    expect(run(input, 'Patient.contact.name ~ Patient.contact.period')).toEqual([false]);
    expect(run(input, '(Patient.contact.name | Patient.contact.period).count()')).toEqual([2]);
    expect(run(input, 'Patient.contact.name = Patient.contact.name')).toEqual([true]);
  });

  it('compares typed complex values by their elements', () => {
    const earlier = { resourceType: 'Observation', effectivePeriod: { start: '2016-03' } };
    const variables = { a: observation, b: earlier, c: { ...observation } };
    expect(run(patient, '%a.effective = %b.effective', { variables })).toEqual([]);
    expect(run(patient, '%a.effective ~ %b.effective', { variables })).toEqual([false]);
    expect(run(patient, '%a.effective = %c.effective', { variables })).toEqual([true]);
    expect(run(patient, '%a = %c', { variables })).toEqual([true]);
  });

  it('keeps Decimal and Integer arithmetic on typed values', () => {
    expect(run(observation, 'Observation.value.value + 1')).toEqual([186]);
    const [sum] = typed(observation, 'Observation.value.value + 1');
    expect(sum).toBeInstanceOf(Decimal);
  });
});
