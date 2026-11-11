/**
 * Model-aware evaluation against the generated providers, R4, R5 and R6, through the internal
 * API ([T0018](../../../docs/tasks/T0018-model-aware-evaluation.md)), with the FHIR functions and
 * variables ([T0020](../../../docs/tasks/T0020-fhir-functions.md)). The same cases run for every
 * provider: the engine has no version-specific code, and the models differ only in their data. The
 * R6 provider is a draft snapshot; these tests show that the engine evaluates with it, and make no
 * R6 conformance claim.
 */
import { describe, expect, it } from 'vitest';
import { r4 } from '../../fhir-r4/src/index.ts';
import { r5 } from '../../fhir-r5/src/index.ts';
import { r6 } from '../../fhir-r6/src/index.ts';
import {
  analyze,
  type CompileOptions,
  compile,
  type EvaluateOptions,
  evaluate,
  evaluateAsync,
} from '../src/api/compile.ts';
import { FhirPathError } from '../src/errors/fhirpath-error.ts';
import { parseJson } from '../src/model/lossless-json.ts';
import { ModelNode } from '../src/model/model-node.ts';
import type { ModelProvider } from '../src/model/model-provider.ts';
import type { CodedValue, Coding } from '../src/runtime/hooks.ts';
import { DateValue } from '../src/values/datetime/date.ts';
import { DateTimeValue } from '../src/values/datetime/datetime.ts';
import { Decimal } from '../src/values/decimal/decimal.ts';
import { Quantity } from '../src/values/quantity/quantity.ts';

const UCUM = 'http://unitsofmeasure.org';
const syllables = { url: 'https://example.org/syllable-count', valueString: 'five' };
const birthTime = {
  url: 'http://hl7.org/fhir/StructureDefinition/patient-birthTime',
  valueDateTime: '1974-12-25T14:35:45-05:00',
};

/** Synthetic data whose elements exist unchanged in R4, R5 and R6. */
const patient = {
  resourceType: 'Patient',
  id: 'p1',
  active: true,
  name: [
    {
      use: 'official',
      given: ['Peter', null],
      _given: [null, { extension: [syllables] }],
      family: 'Chalmers',
    },
    { use: 'maiden', given: ['Jim'] },
  ],
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
  valueQuantity: { value: 185, unit: 'lbs', system: UCUM, code: '[lb_av]' },
};

/**
 * An Observation whose JSON keys are not in definition order. `triggeredBy` is an element in R5
 * and R6 only ([R5](https://hl7.org/fhir/R5/observation-definitions.html#Observation.triggeredBy)).
 */
const triggered = {
  resourceType: 'Observation',
  valueQuantity: { value: 5, unit: 'mg', system: UCUM, code: 'mg' },
  subject: { reference: 'Patient/p1' },
  code: { text: 'glucose' },
  _status: { extension: [syllables] },
  status: 'final',
  triggeredBy: [{ observation: { reference: 'Observation/o0' }, type: 'reflex' }],
};

/** Items nested three levels deep: `Questionnaire.item.item` is a recursive element. */
const questionnaire = {
  resourceType: 'Questionnaire',
  item: [
    {
      linkId: '1',
      type: 'group',
      item: [
        { linkId: '1.1', type: 'group', item: [{ linkId: '1.1.1', type: 'string' }] },
        { linkId: '1.2', type: 'boolean' },
      ],
    },
    { type: 'display', text: 'End', linkId: '2' },
  ],
  status: 'draft',
};

/** An R6 resource ([DeviceAlert](https://hl7.org/fhir/6.0.0-snapshot1/devicealert.html)). */
const deviceAlert = {
  resourceType: 'DeviceAlert',
  status: 'in-progress',
  label: 'SpO2 low',
  acknowledged: false,
  occurrence: { start: '2026-01-01T10:00:00Z' },
};

/**
 * A Patient that contains a DeviceAlert (an R6 resource) and two Observations whose codes share a
 * LOINC coding, for the FHIR functions and variables
 * ([T0020](../../../docs/tasks/T0020-fhir-functions.md)).
 */
const container = {
  resourceType: 'Patient',
  id: 'p1',
  contained: [
    { ...deviceAlert, id: 'da1' },
    {
      resourceType: 'Observation',
      id: 'o1',
      status: 'final',
      code: {
        coding: [{ system: 'http://loinc.org', code: '8480-6', display: 'Systolic' }],
        text: 'SBP',
      },
      subject: { reference: '#' },
    },
    {
      resourceType: 'Observation',
      id: 'o2',
      status: 'final',
      code: {
        coding: [
          { system: 'http://snomed.info/sct', code: '271649006' },
          { system: 'http://loinc.org', code: '8480-6', version: '2.77' },
        ],
      },
      subject: { reference: '#' },
    },
  ],
  managingOrganization: { reference: '#da1' },
};

/** Two quantities of the suite's parameters-quantity-unit-text: unit text only, and UCUM-coded. */
const unitText = {
  resourceType: 'Parameters',
  parameter: [
    { name: 'unit-text', valueQuantity: { value: 1, unit: 'mg/dL' } },
    { name: 'ucum-code', valueQuantity: { value: 2, unit: 'mg/dL', system: UCUM, code: 'mg/dL' } },
  ],
};

interface Expectations {
  readonly version: string;
  /** Whether `Observation.value[x]` allows `Reference` (R5 only) and `Attachment` (R5 and R6). */
  readonly valueReference: boolean;
  readonly valueAttachment: boolean;
  /** Whether `DeviceAlert` is a type of the model (R6 only). */
  readonly deviceAlert: boolean;
  /** Whether `Observation.triggeredBy` is an element (R5 and R6). */
  readonly triggeredBy: boolean;
  /** Whether `Observation.instantiates[x]` is an element (R5 only; the R6 draft removed it). */
  readonly instantiates: boolean;
}

const PROVIDERS: ReadonlyArray<readonly [string, ModelProvider, Expectations]> = [
  [
    'R4',
    r4,
    {
      version: '4.0.1',
      valueReference: false,
      valueAttachment: false,
      deviceAlert: false,
      triggeredBy: false,
      instantiates: false,
    },
  ],
  [
    'R5',
    r5,
    {
      version: '5.0.0',
      valueReference: true,
      valueAttachment: true,
      deviceAlert: false,
      triggeredBy: true,
      instantiates: true,
    },
  ],
  [
    'R6',
    r6,
    {
      version: '6.0.0-snapshot1',
      valueReference: false,
      valueAttachment: true,
      deviceAlert: true,
      triggeredBy: true,
      instantiates: false,
    },
  ],
];

type Options = CompileOptions & EvaluateOptions;

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

function typeName(item: unknown): string | undefined {
  return item instanceof ModelNode ? item.type?.name : undefined;
}

function systemValue(item: unknown): unknown {
  return item instanceof ModelNode ? item.systemValue() : item;
}

describe.each(PROVIDERS)(
  'model-aware evaluation with the generated %s provider',
  (_label, model, expected) => {
    const run = (input: unknown, expression: string, options: Options = {}): unknown[] =>
      evaluate(input, expression, { model, ...options });
    const typed = (input: unknown, expression: string, options: Options = {}): unknown[] =>
      run(input, expression, { ...options, output: 'typed' });

    it('is the generated provider of that version', () => {
      expect(model.namespace).toBe('FHIR');
      expect(model.version).toBe(expected.version);
    });

    // https://hl7.org/fhir/R5/fhirpath.html#rules, docs/spec-notes.md#root-identifiers-with-a-model
    describe('typed navigation', () => {
      it('types nodes by the model and merges primitives with their extensions', () => {
        expect(typed(patient, 'Patient').map(typeName)).toEqual(['Patient']);
        expect(typed(patient, 'Patient.name').map(typeName)).toEqual(['HumanName', 'HumanName']);
        const given = typed(patient, 'Patient.name[0].given') as ModelNode[];
        expect(given.map(typeName)).toEqual(['string', 'string']);
        expect(given.map((node) => node.value)).toEqual(['Peter', undefined]);
        expect(given[1]?.primitiveElement).toEqual({ extension: [syllables] });
        expect(run(patient, 'Patient.name.given.extension.value')).toEqual(['five']);
        // The extension-only given exists, but has no value for Boolean or String operations.
        expect(run(patient, 'Patient.name[0].given[1].exists()')).toEqual([true]);
        expect(run(patient, 'Patient.name[0].given[1] and true')).toEqual([]);
        expect(run(patient, "Patient.name[0].given[1] = 'Peter'")).toEqual([]);
        expect(typed(patient, 'Patient.gender').map(typeName)).toEqual(['code']);
        expect(typed(patient, 'Patient.birthDate').map(typeName)).toEqual(['date']);
        expect(run(patient, 'Patient.birthDate.extension.url')).toEqual([birthTime.url]);
        expect(typed(patient, 'Patient.birthDate.extension.value').map(typeName)).toEqual([
          'dateTime',
        ]);
      });

      it('types contained resources by their resourceType, and navigates by elements only', () => {
        expect(typed(patient, 'Patient.contained').map(typeName)).toEqual([
          'Observation',
          'Resource',
        ]);
        expect(run(patient, 'Patient.contained[0].status')).toEqual(['final']);
        expect(run(patient, 'Patient.contained[1].x')).toEqual([]);
        // T0024: resourceType and an unknown element are semantic errors when the type is known.
        expect(codeOf(() => run(patient, 'Patient.resourceType'))).toBe('semantic/unknown-element');
        expect(codeOf(() => run(patient, 'Patient.unknownElement'))).toBe(
          'semantic/unknown-element',
        );
        expect(run(patient, '%context.resourceType')).toEqual([]);
        expect(run(patient, '%context.unknownElement')).toEqual([]);
      });

      it('reads the root identifier as a type with inheritance, and primitive names as paths', () => {
        expect(run(patient, 'DomainResource.id')).toEqual(['p1']);
        expect(run(patient, 'Resource.id')).toEqual(['p1']);
        expect(run(patient, 'Observation.id')).toEqual([]);
        expect(run(patient, 'id')).toEqual(['p1']);
        expect(run(patient, "Patient.name.where(use = 'official').family")).toEqual(['Chalmers']);
      });
    });

    // https://hl7.org/fhir/R5/fhirpath.html#polymorphism
    describe('choice types', () => {
      it('resolves the one value[x] that is present and types it', () => {
        expect(run(observation, 'Observation.value is Quantity')).toEqual([true]);
        expect(run(observation, 'Observation.value.unit')).toEqual(['lbs']);
        expect(run(observation, 'Observation.value.as(Quantity).unit')).toEqual(['lbs']);
        expect(codeOf(() => run(observation, 'Observation.valueQuantity'))).toBe(
          'semantic/unknown-element',
        );
        expect(run(observation, '%context.valueQuantity')).toEqual([]);
        expect(
          run(observation, 'Observation.valueQuantity.unit', { lenient: { choiceSuffix: true } }),
        ).toEqual(['lbs']);
        expect(run(observation, 'Observation.effective is Period')).toEqual([true]);
        expect(run(patient, 'Patient.deceased is boolean')).toEqual([true]);
        expect(run(patient, 'Patient.deceased')).toEqual([false]);
      });

      // R5 allows Reference and Attachment for Observation.value[x]; R6 keeps Attachment only.
      it('follows the allowed types of this version for Observation.value[x]', () => {
        const reference = {
          resourceType: 'Observation',
          valueReference: { reference: 'Patient/1' },
        };
        const attachment = {
          resourceType: 'Observation',
          valueAttachment: { contentType: 'text/plain' },
        };
        expect(run(reference, 'Observation.value.exists()')).toEqual([expected.valueReference]);
        expect(run(reference, 'Observation.value is Reference')).toEqual(
          expected.valueReference ? [true] : [false],
        );
        // Where the model does not allow the type, the element is unknown to analysis (T0024).
        if (expected.valueReference) {
          expect(run(reference, 'Observation.value.reference')).toEqual(['Patient/1']);
        } else {
          expect(codeOf(() => run(reference, 'Observation.value.reference'))).toBe(
            'semantic/unknown-element',
          );
        }
        expect(run(attachment, 'Observation.value.exists()')).toEqual([expected.valueAttachment]);
        if (expected.valueAttachment) {
          expect(run(attachment, 'Observation.value.contentType')).toEqual(['text/plain']);
        } else {
          expect(codeOf(() => run(attachment, 'Observation.value.contentType'))).toBe(
            'semantic/unknown-element',
          );
        }
        // The allowed types are the model's, so the JSON key alone never makes a value.
        expect(codeOf(() => run(reference, 'Observation.valueReference'))).toBe(
          'semantic/unknown-element',
        );
        expect(run(reference, '%context.valueReference')).toEqual([]);
      });
    });

    // https://hl7.org/fhir/R5/fhirpath.html#types, docs/spec-notes.md#fhirdate-maps-to-systemdate
    describe('FHIR primitives as System values', () => {
      it('converts dates, date/times, Booleans, decimals and UCUM quantities', () => {
        expect(systemValue(typed(patient, 'Patient.birthDate')[0])).toBeInstanceOf(DateValue);
        expect(run(patient, 'Patient.birthDate = @1974-12-25')).toEqual([true]);
        expect(run(patient, 'Patient.birthDate < @1975')).toEqual([true]);
        expect(run(patient, 'Patient.birthDate = @1974-12')).toEqual([]);
        expect(run(patient, 'Patient.birthDate is System.Date')).toEqual([false]);
        expect(run(patient, 'Patient.active = true')).toEqual([true]);
        expect(
          run(patient, 'Patient.birthDate.extension.value = @1974-12-25T14:35:45-05:00'),
        ).toEqual([true]);
        expect(systemValue(typed(observation, 'Observation.issued')[0])).toBeInstanceOf(
          DateTimeValue,
        );
        expect(run(observation, 'Observation.issued is instant')).toEqual([true]);
        expect(run(observation, 'Observation.issued = @2016-03-28T10:30:00Z')).toEqual([true]);
        expect(systemValue(typed(observation, 'Observation.value.value')[0])).toBeInstanceOf(
          Decimal,
        );
        expect(run(observation, 'Observation.value.value = 185')).toEqual([true]);
        expect(systemValue(typed(observation, 'Observation.value')[0])).toBeInstanceOf(Quantity);
        expect(run(observation, "Observation.value = 185 '[lb_av]'")).toEqual([true]);
      });

      it('keeps the precision of lossless JSON input', () => {
        const lossless = parseJson(JSON.stringify(observation).replace('185', '185.50'));
        expect(run(lossless, 'Observation.value.value', { decimalOutput: 'string' })).toEqual([
          '185.50',
        ]);
        expect(run(lossless, "Observation.value = 185.50 '[lb_av]'")).toEqual([true]);
      });
    });

    // docs/spec-notes.md#fhir-primitives-in-is-as-and-oftype
    describe('is and as with model types', () => {
      it.each<[string, unknown[]]>([
        ['Patient is Patient', [true]],
        ['Patient is DomainResource', [true]],
        ['Patient is FHIR.Resource', [true]],
        ['Patient is Observation', [false]],
        ['Patient.as(Observation)', []],
        ['Patient.gender is code', [true]],
        ['Patient.gender is string', [true]], // code derives from string
        ['Patient.gender is id', [false]],
        ['Patient.gender.as(string)', ['male']],
        ['Patient.gender.as(id)', []],
        ['Patient.gender is System.String', [false]],
        ['Patient.name[0] is HumanName', [true]],
        ['Patient.name[0] is Element', [true]],
        ['Patient.contained[0] is Observation', [true]],
        ['Patient.contained[1] is Resource', [true]],
        ['Patient.contained[1] is Patient', [false]],
      ])('%s', (expression, result) => {
        expect(run(patient, expression)).toEqual(result);
      });

      it.each([
        'Patient is System.Patient',
        'Patient.gender is string1',
        'Patient is FHIR.Boolean',
      ])('%s raises eval/unknown-type', (expression) => {
        expect(codeOf(() => run(patient, expression))).toBe('eval/unknown-type');
      });
    });

    // https://hl7.org/fhirpath/N1/#oftypetype-type-specifier-collection: the target resolution of
    // is and as; FHIR primitives also match their System type (docs/spec-notes.md#fhir-primitives-in-is-as-and-oftype).
    describe('ofType() with model types', () => {
      it.each<[string, unknown[]]>([
        ['Patient.ofType(Patient).id', ['p1']],
        ['Patient.ofType(DomainResource).id', ['p1']],
        ['Patient.ofType(FHIR.Resource).id', ['p1']],
        ['Patient.ofType(Observation)', []],
        ['Patient.gender.ofType(code)', ['male']], // testFHIRPathAsFunction17
        ['Patient.gender.ofType(string)', ['male']], // code derives from string
        ['Patient.gender.ofType(id)', []], // testFHIRPathAsFunction18
        ['Patient.gender.ofType(System.String)', ['male']],
        ['Patient.active.ofType(System.Boolean)', [true]],
        ['Patient.active.ofType(Boolean)', [true]],
        ['Patient.birthDate.ofType(System.Date)', ['1974-12-25']],
        ['Patient.birthDate.ofType(System.DateTime)', []],
        ['Patient.name.ofType(HumanName).use', ['official', 'maiden']], // testFHIRPathAsFunction22
        ['Patient.contained.ofType(Observation).status', ['final']],
        ['Patient.contained.ofType(Resource).count()', [2]],
        ['Patient.children().ofType(HumanName).count()', [2]],
      ])('%s', (expression, result) => {
        expect(run(patient, expression)).toEqual(result);
      });

      it.each([
        'Patient.ofType(System.Patient)',
        'Patient.gender.ofType(string1)', // testFHIRPathAsFunction24
        'Patient.ofType(FHIR.Boolean)',
        'Patient.link.ofType(System.Patient)',
      ])('%s raises eval/unknown-type, also on empty input', (expression) => {
        expect(codeOf(() => run(patient, expression))).toBe('eval/unknown-type');
      });

      it('keeps the typed nodes themselves', () => {
        const [name] = typed(patient, 'Patient.name.ofType(HumanName)');
        expect(typeName(name)).toBe('HumanName');
        expect(name).toBeInstanceOf(ModelNode);
      });

      // R5 allows Reference and Attachment for Observation.value[x]; R6 keeps Attachment only.
      it('follows the allowed types of this version for Observation.value[x]', () => {
        const reference = {
          resourceType: 'Observation',
          valueReference: { reference: 'Patient/1' },
        };
        const attachment = {
          resourceType: 'Observation',
          valueAttachment: { contentType: 'text/plain' },
        };
        expect(run(reference, 'Observation.value.ofType(Reference).reference')).toEqual(
          expected.valueReference ? ['Patient/1'] : [],
        );
        expect(run(attachment, 'Observation.value.ofType(Attachment).contentType')).toEqual(
          expected.valueAttachment ? ['text/plain'] : [],
        );
        expect(run(attachment, 'Observation.value.ofType(Reference)')).toEqual([]);
        expect(run(observation, 'Observation.value.ofType(Quantity).unit')).toEqual(['lbs']);
        expect(run(observation, 'Observation.value.ofType(Reference)')).toEqual([]);
      });

      it('keeps a DeviceAlert where the model has it, and raises eval/unknown-type elsewhere', () => {
        const bundle = {
          resourceType: 'Bundle',
          type: 'collection',
          entry: [{ resource: deviceAlert }, { resource: patient }],
        };
        expect(run(bundle, 'Bundle.entry.resource.ofType(Patient).id')).toEqual(['p1']);
        if (expected.deviceAlert) {
          expect(run(bundle, 'Bundle.entry.resource.ofType(DeviceAlert).label')).toEqual([
            'SpO2 low',
          ]);
        } else {
          expect(codeOf(() => run(bundle, 'Bundle.entry.resource.ofType(DeviceAlert)'))).toBe(
            'eval/unknown-type',
          );
          expect(
            codeOf(() => run(bundle, 'Bundle.entry.resource.take(0).ofType(DeviceAlert)')),
          ).toBe('eval/unknown-type');
        }
      });
    });

    // https://hl7.org/fhirpath/N1/#equals: different resource types with the same populated elements.
    describe('equality of typed resources', () => {
      const resources = [
        { resourceType: 'Patient', id: 'x' },
        { resourceType: 'Practitioner', id: 'x' },
        { resourceType: 'Patient', id: 'x' },
      ];

      it('is false across resource types, and a union keeps both resources', () => {
        expect(run(resources, '$this[0] = $this[1]')).toEqual([false]);
        expect(run(resources, '$this[0] ~ $this[1]')).toEqual([false]);
        expect(run(resources, '$this[0] = $this[2]')).toEqual([true]);
        expect(run(resources, '($this[0] | $this[1]).count()')).toEqual([2]);
        expect(run(resources, '($this[0] | $this[2]).count()')).toEqual([1]);
      });

      it('is false across element types even when the elements share one JSON object', () => {
        const shared = { text: 'x' };
        const input = { resourceType: 'Patient', name: [shared, shared], address: [shared] };
        expect(run(input, 'Patient.name[0] = Patient.address')).toEqual([false]);
        expect(run(input, 'Patient.name[0] ~ Patient.address')).toEqual([false]);
        expect(run(input, '(Patient.name[0] | Patient.address).count()')).toEqual([2]);
        expect(run(input, 'Patient.name[0] = Patient.name[1]')).toEqual([true]);
        expect(run(input, 'Patient.name.count()')).toEqual([2]);
      });
    });

    // https://hl7.org/fhirpath/N1/#subsetting and https://hl7.org/fhirpath/N1/#combining: the
    // functions select the typed nodes themselves, and compare them by their System values.
    describe('subsetting and combining typed nodes', () => {
      it('selects typed nodes without converting them', () => {
        for (const call of ['last()', 'skip(1)', 'tail()', 'take(5).last()']) {
          const result = typed(patient, `Patient.name.${call}`);
          expect(result).toHaveLength(1);
          expect(typeName(result[0])).toBe('HumanName');
          expect(result[0]).toBeInstanceOf(ModelNode);
        }
        expect(run(patient, 'Patient.name.last().use')).toEqual(['maiden']);
        expect(run(patient, 'Patient.name.skip(1).given')).toEqual(['Jim']);
        expect(run(patient, 'Patient.name.take(1).given.first()')).toEqual(['Peter']);
      });

      it('compares a typed primitive with a System value', () => {
        expect(run(patient, 'Patient.birthDate.intersect(@1974-12-25).count()')).toEqual([1]);
        expect(run(patient, 'Patient.birthDate.exclude(@1974-12-25).count()')).toEqual([0]);
        expect(run(patient, 'Patient.birthDate.exclude(@1974-12-26).count()')).toEqual([1]);
        expect(run(patient, 'Patient.birthDate.union(@1974-12-25).count()')).toEqual([1]);
        // A different precision is undetermined, so neither equal nor excluded.
        expect(run(patient, 'Patient.birthDate.intersect(@1974-12).count()')).toEqual([0]);
        expect(run(patient, 'Patient.birthDate.exclude(@1974-12).count()')).toEqual([1]);
        const [node] = typed(patient, 'Patient.birthDate.intersect(@1974-12-25)');
        expect(typeName(node)).toBe('date');
        expect(node).toBeInstanceOf(ModelNode);
      });

      it('compares typed complex values of one type by their elements', () => {
        const copy = { resourceType: 'Patient', name: [{ use: 'maiden', given: ['Jim'] }] };
        const input = { a: patient, b: copy };
        expect(run(input, 'a.name.last().intersect(b.name).given')).toEqual(['Jim']);
        expect(run(input, 'a.name.exclude(b.name).count()')).toEqual([1]);
        expect(run(input, 'a.name.union(b.name).count()')).toEqual([2]);
      });

      it('never takes elements of different types as equal, even with one JSON object', () => {
        const shared = { text: 'x' };
        const input = { resourceType: 'Patient', name: [shared], address: [shared] };
        expect(run(input, 'Patient.name.intersect(Patient.address).count()')).toEqual([0]);
        expect(run(input, 'Patient.name.exclude(Patient.address).count()')).toEqual([1]);
        expect(run(input, 'Patient.name.union(Patient.address).count()')).toEqual([2]);
        expect(run(input, 'Patient.name.combine(Patient.address).count()')).toEqual([2]);
        expect(run(input, 'Patient.name.intersect(Patient.name).count()')).toEqual([1]);
      });

      it('keeps every typed node of combine() and the first of union()', () => {
        const combined = typed(patient, 'Patient.name.combine(Patient.name)');
        expect(combined).toHaveLength(4);
        expect(combined.map(typeName)).toEqual(Array(4).fill('HumanName'));
        const merged = typed(patient, 'Patient.name.union(Patient.name)');
        expect(merged).toEqual(typed(patient, 'Patient.name'));
      });
    });

    // https://hl7.org/fhirpath/N1/#existence: the functions read typed nodes by their System
    // values and return the nodes themselves (docs/spec-notes.md#distinct-and-isdistinct).
    describe('existence functions on typed nodes', () => {
      it('reads FHIR booleans, and leaves out a boolean that holds only extensions', () => {
        expect(run(patient, 'Patient.active.combine(Patient.deceased).allTrue()')).toEqual([false]);
        expect(run(patient, 'Patient.active.combine(Patient.deceased).anyTrue()')).toEqual([true]);
        const extended = { resourceType: 'Patient', _active: { extension: [syllables] } };
        expect(run(extended, 'Patient.active.exists()')).toEqual([true]);
        expect(run(extended, 'Patient.active.allFalse()')).toEqual([true]);
        expect(run(extended, 'Patient.active.anyTrue()')).toEqual([false]);
        // T0024: a code is never a Boolean, which analysis reports with the model.
        expect(codeOf(() => run(patient, 'Patient.gender.allTrue()'))).toBe(
          'semantic/type-mismatch',
        );
        expect(codeOf(() => run(patient, '%context.gender.allTrue()'))).toBe('eval/type-mismatch');
      });

      // docs/spec-notes.md#distinct-and-isdistinct: an element without a value is never equal to
      // another item, so it never repeats.
      it('keeps an element that holds only extensions in distinct()', () => {
        const absent = { extension: [syllables] };
        const one = {
          resourceType: 'Patient',
          name: [{ given: ['Ann', 'Ann', null], _given: [null, null, absent] }],
        };
        expect(run(one, 'Patient.name.given.count()')).toEqual([3]);
        const [ann, valueless] = typed(one, 'Patient.name.given.distinct()');
        expect(typed(one, 'Patient.name.given.distinct()')).toHaveLength(2);
        expect(systemValue(ann)).toBe('Ann');
        expect(typeName(valueless)).toBe('string');
        expect(systemValue(valueless)).toBeUndefined();
        expect(run(one, 'Patient.name.given.isDistinct()')).toEqual([false]);
        expect(run(one, 'Patient.name.given.skip(1).isDistinct()')).toEqual([true]);
        const two = {
          resourceType: 'Patient',
          name: [{ given: [null, null], _given: [absent, absent] }],
        };
        expect(run(two, 'Patient.name.given.distinct().count()')).toEqual([2]);
        expect(run(two, 'Patient.name.given.isDistinct()')).toEqual([true]);
        expect(run(two, "Patient.name.given.combine('Ann').isDistinct()")).toEqual([true]);
      });

      it('keeps complex values whose children cannot be compared in distinct()', () => {
        const absent = { extension: [syllables] };
        const names = {
          resourceType: 'Patient',
          name: [
            { given: ['Ann', null], _given: [null, absent] },
            { given: ['Ann', null], _given: [null, absent] },
            { period: { start: '2020' } },
            { period: { start: '2020-01-01' } },
          ],
        };
        expect(run(names, 'Patient.name.distinct().count()')).toEqual([4]);
        expect(run(names, 'Patient.name.isDistinct()')).toEqual([true]);
        // The starts differ in precision, so their equality is undetermined: distinct (3.0.0).
        expect(run(names, 'Patient.name.period.start.isDistinct()')).toEqual([true]);
      });

      // The 3.0.0 form of the allTrue() examples: Observation.component.select(value > 90 'mm[Hg]').
      it('tests projected FHIR Quantity comparisons with allTrue() and the like', () => {
        const pressure = (value: number) => ({
          valueQuantity: { value, unit: 'mmHg', system: UCUM, code: 'mm[Hg]' },
        });
        const bp = { resourceType: 'Observation', component: [pressure(120), pressure(85)] };
        const projection = "Observation.component.select(value > 90 'mm[Hg]')";
        expect(run(bp, projection)).toEqual([true, false]);
        expect(run(bp, `${projection}.allTrue()`)).toEqual([false]);
        expect(run(bp, `${projection}.anyTrue()`)).toEqual([true]);
        expect(run(bp, `${projection}.allFalse()`)).toEqual([false]);
        expect(run(bp, `${projection}.anyFalse()`)).toEqual([true]);
      });

      it('keeps the last of a code and a String with the same value (testDistinct31)', () => {
        const [string] = typed(patient, "Patient.gender.combine('male').distinct()");
        expect(string).toBe('male');
        const [code] = typed(patient, "'male'.combine(Patient.gender).distinct()");
        expect(typeName(code)).toBe('code');
        expect(run(patient, "Patient.gender.combine('male').isDistinct()")).toEqual([false]);
      });

      it('compares typed elements by type and value', () => {
        const names = typed(patient, 'Patient.name.combine(Patient.name).distinct()');
        expect(names.map(typeName)).toEqual(['HumanName', 'HumanName']);
        expect(run(patient, 'Patient.name.isDistinct()')).toEqual([true]);
        expect(run(patient, 'Patient.name.first().subsetOf(Patient.name)')).toEqual([true]);
        expect(run(patient, 'Patient.name.supersetOf(Patient.name.last())')).toEqual([true]);
        const shared = { text: 'x' };
        const input = { resourceType: 'Patient', name: [shared], address: [shared] };
        expect(run(input, 'Patient.name.combine(Patient.address).isDistinct()')).toEqual([true]);
        expect(run(input, 'Patient.name.subsetOf(Patient.address)')).toEqual([false]);
      });

      it('compares a typed date with a date literal', () => {
        expect(run(patient, 'Patient.birthDate.subsetOf(@1974-12-25)')).toEqual([true]);
        expect(run(patient, 'Patient.birthDate.subsetOf(@1974-12)')).toEqual([false]);
        expect(run(patient, 'Patient.birthDate.combine(@1974-12-25).isDistinct()')).toEqual([
          false,
        ]);
        // The precisions differ, so the equality is undetermined: distinct (3.0.0).
        const [birthDate] = typed(patient, 'Patient.birthDate.combine(@1974-12).distinct()');
        expect(typeName(birthDate)).toBe('date');
        expect(
          run(patient, 'Patient.birthDate.combine(@1974-12).distinct().select(toString())'),
        ).toEqual(['1974-12-25', '1974-12']);
        expect(run(patient, 'Patient.birthDate.combine(@1974-12).isDistinct()')).toEqual([true]);
      });
    });

    // https://hl7.org/fhirpath/N1/#tree-navigation, docs/spec-notes.md#order-of-descendants
    describe('children() and descendants()', () => {
      const names = (input: unknown, expression: string): string[] =>
        typed(input, expression).map((item) => (item instanceof ModelNode ? item.name : '?'));

      it("lists this version's elements in definition order, not in JSON order", () => {
        const elements = ['status', 'code', 'subject', 'value'];
        expect(names(triggered, 'Observation.children()')).toEqual(
          expected.triggeredBy ? ['triggeredBy', ...elements] : elements,
        );
        expect(typed(triggered, 'Observation.children()').map(typeName)).toEqual([
          ...(expected.triggeredBy ? ['Observation.triggeredBy'] : []),
          'code',
          'CodeableConcept',
          'Reference',
          'Quantity',
        ]);
      });

      it('folds _status into the status node, and only lists elements', () => {
        expect(names(triggered, 'Observation.children()')).not.toContain('_status');
        expect(run(triggered, 'Observation.status.children().url')).toEqual([syllables.url]);
        expect(run(triggered, 'Observation.children().where($this is code)')).toEqual(['final']);
      });

      it("reaches triggeredBy's data only where it is an element", () => {
        expect(run(triggered, 'Observation.descendants().type')).toEqual(
          expected.triggeredBy ? ['reflex'] : [],
        );
        expect(run(triggered, 'Observation.descendants().reference')).toEqual(
          expected.triggeredBy ? ['Observation/o0', 'Patient/p1'] : ['Patient/p1'],
        );
      });

      it('terminates on nested Questionnaire.item and keeps document order', () => {
        expect(run(questionnaire, 'Questionnaire.descendants().linkId')).toEqual([
          '1',
          '1.1',
          '1.1.1',
          '1.2',
          '2',
        ]);
        expect(
          typed(questionnaire, 'Questionnaire.descendants().where(linkId.exists())').map(typeName),
        ).toEqual(Array(5).fill('Questionnaire.item'));
        // status, 5 items, and the 11 primitives inside them
        expect(run(questionnaire, 'Questionnaire.descendants().count()')).toEqual([17]);
        expect(run(questionnaire, 'Questionnaire.item[1].children()')).toEqual([
          '2',
          'End',
          'display',
        ]);
      });

      // https://hl7.org/fhirpath/N1/#repeatprojection-expression-collection
      // docs/spec-notes.md#repeat: `=` on an element that holds only extensions is empty, so only
      // the node check stops repeat() from adding it again and again until the limit.
      it('finds an element that holds only extensions once, in sync and async mode', async () => {
        const absent = { extension: [syllables] };
        const extended = {
          resourceType: 'Patient',
          _active: absent,
          name: [{ given: ['Ann', null, null], _given: [null, absent, absent] }],
        };
        const cases: [string, unknown[]][] = [
          ['Patient.active.repeat($this).count()', [1]],
          ['Patient.active.repeat(%resource.active).count()', [1]],
          ['Patient.repeat(active).count()', [1]],
          ['Patient.active.repeat($this).hasValue()', [false]],
          // Two elements without a value stay two items, also when they share one JSON object.
          ['Patient.name.given.repeat($this).count()', [3]],
          ['Patient.name.repeat(given).count()', [3]],
          ['Patient.name.given.combine(Patient.name.given).repeat($this).count()', [3]],
        ];
        for (const [expression, result] of cases) {
          expect(run(extended, expression)).toEqual(result);
          expect(await evaluateAsync(extended, expression, { model })).toEqual(result);
        }
        const tight = { limits: { maxRepeatItems: 3 } };
        expect(run(extended, 'Patient.name.given.repeat($this).count()', tight)).toEqual([3]);
      });

      it('repeats item to every nested Questionnaire.item, breadth first', () => {
        expect(run(questionnaire, 'Questionnaire.repeat(item).linkId')).toEqual([
          '1',
          '2',
          '1.1',
          '1.2',
          '1.1.1',
        ]);
        expect(typed(questionnaire, 'Questionnaire.repeat(item)').map(typeName)).toEqual(
          Array(5).fill('Questionnaire.item'),
        );
      });
    });

    // https://hl7.org/fhir/R5/fhirpath.html#functions, docs/tasks/T0020-fhir-functions.md
    describe('FHIR functions and variables', () => {
      it('reads extension() and hasValue() on a primitive with only extensions', () => {
        expect(run(patient, 'Patient.name[0].given[1].exists()')).toEqual([true]);
        expect(run(patient, 'Patient.name[0].given[1].hasValue()')).toEqual([false]);
        expect(run(patient, 'Patient.name[0].given[1].getValue()')).toEqual([]);
        expect(
          run(patient, `Patient.name[0].given[1].extension('${syllables.url}').value`),
        ).toEqual(['five']);
        expect(run(patient, 'Patient.name[0].given[0].hasValue()')).toEqual([true]);
        expect(run(patient, 'Patient.name[0].hasValue()')).toEqual([false]);
        expect(run(patient, `Patient.birthDate.extension('${birthTime.url}').value`)).toEqual([
          birthTime.valueDateTime,
        ]);
        expect(
          run(patient, 'Patient.birthDate.extension(%`ext-patient-birthTime`).exists()'),
        ).toEqual([true]);
        expect(run(patient, 'Patient.birthDate.getValue() is System.Date')).toEqual([true]);
      });

      it('derives %resource and %rootResource for a node in a contained resource', () => {
        const [status] = typed(container, "Patient.contained.where(id = 'o1').status");
        expect(run(status, '%resource.id')).toEqual(['o1']);
        expect(run(status, '%rootResource.id')).toEqual(['p1']);
        expect(run(status, '%resource is Observation and %rootResource is Patient')).toEqual([
          true,
        ]);
        const [alert] = typed(container, "Patient.contained.where(id = 'da1')");
        expect(run(alert, '%resource.id | %rootResource.id')).toEqual(['da1', 'p1']);
        expect(run(container, '%resource.id | %rootResource.id')).toEqual(['p1']);
      });

      it('compares Coding and CodeableConcept by FHIR equivalence', () => {
        expect(run(container, 'Patient.contained[1].code ~ Patient.contained[2].code')).toEqual([
          true,
        ]);
        expect(run(container, 'Patient.contained[1].code = Patient.contained[2].code')).toEqual([
          false,
        ]);
        expect(
          run(container, 'Patient.contained[1].code.coding ~ Patient.contained[2].code.coding[1]'),
        ).toEqual([true]);
        expect(
          run(container, 'Patient.contained[1].code.coding ~ Patient.contained[2].code.coding[0]'),
        ).toEqual([false]);
        // The ids differ and are ignored; the codes are equivalent.
        expect(run(container, 'Patient.contained[1] ~ Patient.contained[2]')).toEqual([true]);
        expect(run(container, 'Patient.contained[1] = Patient.contained[2]')).toEqual([false]);
      });

      it('resolves a contained DeviceAlert, typed where the model has it and as Resource elsewhere', () => {
        expect(run(container, 'Patient.managingOrganization.resolve().id')).toEqual(['da1']);
        expect(run(container, 'Patient.contained[1].subject.resolve().id')).toEqual(['p1']);
        const resolved = typed(container, "'#da1'.resolve()");
        expect(resolved.map(typeName)).toEqual([expected.deviceAlert ? 'DeviceAlert' : 'Resource']);
        expect(run(container, "'#da1'.resolve() is Resource")).toEqual([true]);
        if (expected.deviceAlert) {
          expect(run(container, "'#da1'.resolve() is DeviceAlert")).toEqual([true]);
          expect(run(container, "'#da1'.resolve().label")).toEqual(['SpO2 low']);
        } else {
          expect(codeOf(() => run(container, "'#da1'.resolve() is DeviceAlert"))).toBe(
            'eval/unknown-type',
          );
          // The declared type of `contained` has no `label` element.
          expect(run(container, "'#da1'.resolve().label")).toEqual([]);
        }
      });

      it('orders a quantity with unit text against a UCUM-coded one (#150)', () => {
        expect(
          run(unitText, 'Parameters.parameter[0].value < Parameters.parameter[1].value'),
        ).toEqual([true]);
        expect(
          run(unitText, 'Parameters.parameter[1].value >= Parameters.parameter[0].value'),
        ).toEqual([true]);
      });
    });

    // docs/tasks/T0021-hooks-async.md#scope: hooks know nothing about FHIR versions; what a
    // resolve hook returns is typed by the provider like the input.
    describe('host hooks', () => {
      const div = '<div xmlns="http://www.w3.org/1999/xhtml"><p>Peter</p></div>';
      const narrated = { ...patient, text: { status: 'generated', div } };

      it('types a resource from the resolve hook like the input: DeviceAlert under R6 only', () => {
        const hooks = {
          resolve: (reference: string) =>
            reference === 'DeviceAlert/da1'
              ? deviceAlert
              : reference === 'Patient/p1'
                ? patient
                : undefined,
        };
        expect(typed(null, "'Patient/p1'.resolve()", { hooks }).map(typeName)).toEqual(['Patient']);
        expect(run(null, "'Patient/p1'.resolve().name.use", { hooks })).toEqual([
          'official',
          'maiden',
        ]);
        expect(run(null, "'Patient/missing'.resolve()", { hooks })).toEqual([]);
        expect(typed(null, "'DeviceAlert/da1'.resolve()", { hooks }).map(typeName)).toEqual([
          expected.deviceAlert ? 'DeviceAlert' : undefined,
        ]);
        if (expected.deviceAlert) {
          expect(run(null, "'DeviceAlert/da1'.resolve() is DeviceAlert", { hooks })).toEqual([
            true,
          ]);
          expect(run(null, "'DeviceAlert/da1'.resolve().label", { hooks })).toEqual(['SpO2 low']);
          expect(
            run(null, "'DeviceAlert/da1'.resolve().occurrence.start < @2027", { hooks }),
          ).toEqual([true]);
        } else {
          expect(
            codeOf(() => run(null, "'DeviceAlert/da1'.resolve() is DeviceAlert", { hooks })),
          ).toBe('eval/unknown-type');
          // Untyped data: its keys are navigable, but its strings are not dates.
          expect(run(null, "'DeviceAlert/da1'.resolve().label", { hooks })).toEqual(['SpO2 low']);
          expect(
            codeOf(() =>
              run(null, "'DeviceAlert/da1'.resolve().occurrence.start < @2027", { hooks }),
            ),
          ).toBe('eval/type-mismatch');
        }
      });

      it('forwards xhtml as the element and other strings as content to the htmlChecks hook', () => {
        const calls: [string, string][] = [];
        const hooks = {
          htmlChecks: (html: string, context: { readonly kind: string }) => {
            calls.push([html, context.kind]);
            return true;
          },
        };
        expect(run(narrated, 'Patient.text.`div`.htmlChecks()', { hooks })).toEqual([true]);
        expect(run(narrated, 'Patient.name.family.htmlChecks()', { hooks })).toEqual([true]);
        expect(run(narrated, 'Patient.id.htmlChecks()', { hooks })).toEqual([true]);
        expect(run(narrated, 'Patient.active.htmlChecks()', { hooks })).toEqual([]);
        expect(run(narrated, 'Patient.text.htmlChecks()', { hooks })).toEqual([]);
        expect(run(narrated, 'Patient.name.htmlChecks()', { hooks })).toEqual([]);
        expect(calls).toEqual([
          [div, 'xhtml'],
          ['Chalmers', 'string'],
          ['p1', 'string'],
        ]);
      });

      it('passes codes, Codings and CodeableConcepts to the terminology provider', () => {
        const seen: [string, number][] = [];
        const hooks = {
          terminology: {
            memberOf: (coded: CodedValue) => {
              seen.push([coded.kind, coded.codings.length]);
              return true;
            },
          },
        };
        const vs = 'http://example.org/vs';
        expect(
          run(patient, 'Patient.gender.memberOf(%`vs-administrative-gender`)', { hooks }),
        ).toEqual([true]);
        expect(run(container, `Patient.contained[2].code.memberOf('${vs}')`, { hooks })).toEqual([
          true,
        ]);
        expect(
          run(container, `Patient.contained[2].code.coding.first().memberOf('${vs}')`, { hooks }),
        ).toEqual([true]);
        expect(run(container, `Patient.contained[2].memberOf('${vs}')`, { hooks })).toEqual([]);
        expect(seen).toEqual([
          ['code', 1],
          ['CodeableConcept', 2],
          ['Coding', 1],
        ]);
      });

      it('knows equal codings are equivalent and asks the provider about the others', () => {
        const pairs: string[] = [];
        const hooks = {
          terminology: {
            subsumes: (a: Coding, b: Coding) => {
              pairs.push(`${a.code}>${b.code}`);
              return 'not-subsumed' as const;
            },
          },
        };
        // The LOINC coding of the second Observation is that of the first in another version.
        expect(
          run(
            container,
            'Patient.contained[2].code.coding[1].subsumes(Patient.contained[1].code.coding[0])',
            { hooks },
          ),
        ).toEqual([true]);
        expect(
          run(container, 'Patient.contained[1].code.subsumedBy(Patient.contained[2].code)', {
            hooks,
          }),
        ).toEqual([true]);
        expect(
          run(
            container,
            'Patient.contained[2].code.coding[0].subsumes(Patient.contained[1].code.coding[0])',
            { hooks },
          ),
        ).toEqual([false]);
        expect(pairs).toEqual(['8480-6>271649006', '271649006>8480-6']);
      });

      it('passes the JSON of the resource and the profile to the conformsTo hook', () => {
        const seen: unknown[] = [];
        const hooks = {
          conformsTo: (value: unknown, profile: string) => {
            seen.push(value, profile);
            return profile.endsWith('/Patient');
          },
        };
        const base = 'http://hl7.org/fhir/StructureDefinition/';
        expect(run(patient, `conformsTo('${base}Patient')`, { hooks })).toEqual([true]);
        expect(run(patient, `conformsTo('${base}Person')`, { hooks })).toEqual([false]);
        expect(seen).toEqual([patient, `${base}Patient`, patient, `${base}Person`]);
        expect(seen[0]).toBe(patient);
      });
    });

    // https://hl7.org/fhir/6.0.0-snapshot1/devicealert.html: a resource that R4 and R5 do not have.
    describe('a resource of one version only', () => {
      it('is a type with its elements where the model has it, and unknown data elsewhere', () => {
        expect(model.getType('DeviceAlert') !== undefined).toBe(expected.deviceAlert);
        if (expected.deviceAlert) {
          expect(run(deviceAlert, '$this is DeviceAlert')).toEqual([true]);
          expect(run(deviceAlert, '$this is DomainResource')).toEqual([true]);
          expect(typed(deviceAlert, 'DeviceAlert').map(typeName)).toEqual(['DeviceAlert']);
          expect(run(deviceAlert, 'DeviceAlert.label')).toEqual(['SpO2 low']);
          expect(typed(deviceAlert, 'DeviceAlert.status').map(typeName)).toEqual(['code']);
          expect(run(deviceAlert, 'DeviceAlert.status is code')).toEqual([true]);
          expect(run(deviceAlert, 'DeviceAlert.acknowledged = false')).toEqual([true]);
          expect(typed(deviceAlert, 'DeviceAlert.occurrence').map(typeName)).toEqual(['Period']);
          expect(run(deviceAlert, 'DeviceAlert.occurrence.start < @2027')).toEqual([true]);
        } else {
          expect(codeOf(() => run(deviceAlert, '$this is DeviceAlert'))).toBe('eval/unknown-type');
          expect(run(deviceAlert, '$this is DomainResource')).toEqual([false]);
          expect(typed(deviceAlert, '$this').map(typeName)).toEqual([undefined]);
          // An unknown resource is plain JSON: its name is a path, and its keys are navigable, but
          // its strings are never read as dates while a model is supplied (spec notes: model-less
          // date convenience).
          expect(run(deviceAlert, 'DeviceAlert.label')).toEqual([]);
          expect(run(deviceAlert, 'label')).toEqual(['SpO2 low']);
          expect(run(deviceAlert, 'occurrence.start')).toEqual(['2026-01-01T10:00:00Z']);
          expect(codeOf(() => run(deviceAlert, 'occurrence.start < @2027'))).toBe(
            'eval/type-mismatch',
          );
        }
      });
    });

    // Static analysis with this version's types (T0024). The analyzer has no version-specific
    // code: what is an element, a type or a choice type comes from the provider.
    describe('static analysis', () => {
      const report = (expression: string, options: CompileOptions): string[] =>
        analyze(expression, { model, ...options }).diagnostics.map(
          (diagnostic) => `${diagnostic.severity} ${diagnostic.code}`,
        );
      const unknownElement = ['error semantic/unknown-element'];

      it('knows the elements of this version', () => {
        const input: CompileOptions = { inputType: 'Observation' };
        expect(report('Observation.triggeredBy', input)).toEqual(
          expected.triggeredBy ? [] : unknownElement,
        );
        expect(report('triggeredBy.type', input)).toEqual(
          expected.triggeredBy ? [] : unknownElement,
        );
        expect(report('Observation.instantiates', input)).toEqual(
          expected.instantiates ? [] : unknownElement,
        );
        expect(report('Observation.value.reference', input)).toEqual(
          expected.valueReference ? [] : unknownElement,
        );
        expect(report('Observation.value.contentType', input)).toEqual(
          expected.valueAttachment ? [] : unknownElement,
        );
        expect(report('Observation.value.unit', input)).toEqual([]);
      });

      it('accepts the input types of this version', () => {
        const alert: CompileOptions = { inputType: 'DeviceAlert' };
        const unknownType = ['error semantic/unknown-type'];
        expect(report('status', alert)).toEqual(expected.deviceAlert ? [] : unknownType);
        expect(report('DeviceAlert.label.length()', alert)).toEqual(
          expected.deviceAlert ? [] : unknownType,
        );
        expect(codeOf(() => compile('DeviceAlert.label', { model, ...alert }))).toBe(
          expected.deviceAlert ? undefined : 'semantic/unknown-type',
        );
        // Without an input type, the leading identifier names the type, which R6 alone has.
        expect(report('DeviceAlert.label', {})).toEqual(expected.deviceAlert ? [] : []);
        expect(report('DeviceAlert.nothing', {})).toEqual(
          expected.deviceAlert ? unknownElement : [],
        );
      });

      // testSimpleFail, testSimpleWithWrongContext, testPolymorphismB, testPolymorphismAsB,
      // testDollarOrderNotAllowed, testIif6 and isEffectOnLogic3Base, with the generated models.
      it("reports the suite's semantic errors", () => {
        const input: CompileOptions = { inputType: 'Patient' };
        expect(report('name.given1', input)).toEqual(unknownElement);
        expect(report('Encounter.name.given', input)).toEqual(['error semantic/type-mismatch']);
        expect(
          analyze('Observation.valueQuantity.unit', { model, inputType: 'Observation' })
            .diagnostics[0],
        ).toMatchObject({
          code: 'semantic/unknown-element',
          hint: 'value.ofType(Quantity)',
        });
        expect(report('(Observation.value as Period).unit', { inputType: 'Observation' })).toEqual(
          unknownElement,
        );
        // testDollarOrderNotAllowed and testIif6 are strict mode (T0024b).
        expect(report('Patient.children().skip(1)', input)).toEqual([]);
        expect(report('$this.toString().length() > 10', { inputType: 'Period' })).toEqual([
          'error semantic/type-mismatch',
        ]);
        expect(report('$this.toString().length() > 10', { inputType: 'dateTime' })).toEqual([]);
        expect(
          report('$this is Period or $this.toString().length() >= 10', {
            inputType: ['Period', 'dateTime'],
          }),
        ).toEqual([]);
      });

      it('warns about a fraction that a typed element ignores, and evaluates as before', () => {
        expect(report('birthDate + 7.7 days', { inputType: 'Patient' })).toEqual([
          'warning semantic/fraction-ignored',
        ]);
        // A choice element may be a Period, so the analyzer cannot tell; a Quantity is not a date.
        expect(report('effective + 7.7 days', { inputType: 'Observation' })).toEqual([]);
        expect(report('value.ofType(Quantity) + 7.7 days', { inputType: 'Observation' })).toEqual(
          [],
        );
        expect(run(patient, 'birthDate + 7.7 days', { inputType: 'Patient' })).toEqual([
          '1975-01-01',
        ]);
      });
    });
  },
);
