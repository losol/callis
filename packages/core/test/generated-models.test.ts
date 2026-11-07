/**
 * Model-aware evaluation against the generated providers, R4, R5 and R6, through the internal
 * API ([T0018](../../../docs/tasks/T0018-model-aware-evaluation.md)). The same cases run for every
 * provider: the engine has no version-specific code, and the models differ only in their data. The
 * R6 provider is a draft snapshot; these tests show that the engine evaluates with it, and make no
 * R6 conformance claim.
 */
import { describe, expect, it } from 'vitest';
import { r4 } from '../../fhir-r4/src/index.ts';
import { r5 } from '../../fhir-r5/src/index.ts';
import { r6 } from '../../fhir-r6/src/index.ts';
import { type CompileOptions, type EvaluateOptions, evaluate } from '../src/api/compile.ts';
import { FhirPathError } from '../src/errors/fhirpath-error.ts';
import { parseJson } from '../src/model/lossless-json.ts';
import { ModelNode } from '../src/model/model-node.ts';
import type { ModelProvider } from '../src/model/model-provider.ts';
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

/** An R6 resource ([DeviceAlert](https://hl7.org/fhir/6.0.0-snapshot1/devicealert.html)). */
const deviceAlert = {
  resourceType: 'DeviceAlert',
  status: 'in-progress',
  label: 'SpO2 low',
  acknowledged: false,
  occurrence: { start: '2026-01-01T10:00:00Z' },
};

interface Expectations {
  readonly version: string;
  /** Whether `Observation.value[x]` allows `Reference` (R5 only) and `Attachment` (R5 and R6). */
  readonly valueReference: boolean;
  readonly valueAttachment: boolean;
  /** Whether `DeviceAlert` is a type of the model (R6 only). */
  readonly deviceAlert: boolean;
}

const PROVIDERS: ReadonlyArray<readonly [string, ModelProvider, Expectations]> = [
  [
    'R4',
    r4,
    { version: '4.0.1', valueReference: false, valueAttachment: false, deviceAlert: false },
  ],
  ['R5', r5, { version: '5.0.0', valueReference: true, valueAttachment: true, deviceAlert: false }],
  [
    'R6',
    r6,
    { version: '6.0.0-snapshot1', valueReference: false, valueAttachment: true, deviceAlert: true },
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
        expect(run(patient, 'Patient.resourceType')).toEqual([]);
        expect(run(patient, 'Patient.unknownElement')).toEqual([]);
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
        expect(run(observation, 'Observation.valueQuantity')).toEqual([]);
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
        expect(run(reference, 'Observation.value.reference')).toEqual(
          expected.valueReference ? ['Patient/1'] : [],
        );
        expect(run(attachment, 'Observation.value.exists()')).toEqual([expected.valueAttachment]);
        expect(run(attachment, 'Observation.value.contentType')).toEqual(
          expected.valueAttachment ? ['text/plain'] : [],
        );
        // The allowed types are the model's, so the JSON key alone never makes a value.
        expect(run(reference, 'Observation.valueReference')).toEqual([]);
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
  },
);
