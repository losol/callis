import type { ModelProvider, SystemTypeName } from '@callis/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { describeModelProviderContract } from '../../../packages/core/test/support/model-provider-contract.ts';
import type { TypeRow } from '../runtime/model-data.ts';

/** Applies the existing core contract and acceptance tests to every generated root. */
export function describeGeneratedProvider(provider: ModelProvider, rows: readonly TypeRow[]): void {
  const r5 = provider.version === '5.0.0';
  const systemTypes: ReadonlyArray<readonly [string, Exclude<SystemTypeName, 'Any'> | undefined]> =
    [
      ['base64Binary', 'String'],
      ['boolean', 'Boolean'],
      ['canonical', 'String'],
      ['code', 'String'],
      ['date', 'Date'],
      ['dateTime', 'DateTime'],
      ['decimal', 'Decimal'],
      ['id', 'String'],
      ['instant', 'DateTime'],
      ['integer', 'Integer'],
      ['markdown', 'String'],
      ['oid', 'String'],
      ['positiveInt', 'Integer'],
      ['string', 'String'],
      ['time', 'Time'],
      ['unsignedInt', 'Integer'],
      ['uri', 'String'],
      ['url', 'String'],
      ['uuid', 'String'],
      ['xhtml', 'String'],
      ['Quantity', 'Quantity'],
      ['Age', 'Quantity'],
      ['Count', 'Quantity'],
      ['Distance', 'Quantity'],
      ['Duration', 'Quantity'],
      ['Money', undefined],
      ['Patient', undefined],
      ['Element', undefined],
      ...(r5 ? [['integer64', 'Long'] as const, ['PrimitiveType', undefined] as const] : []),
    ];
  const observationTypes = [
    'Quantity',
    'CodeableConcept',
    'string',
    'boolean',
    'integer',
    'Range',
    'Ratio',
    'SampledData',
    'time',
    'dateTime',
    'Period',
    ...(r5 ? ['Attachment', 'Reference'] : []),
  ];
  describeModelProviderContract(provider, {
    startTypes: rows.filter((row) => row[1] !== 'backbone').map((row) => row[0]),
    resourceType: 'Patient',
    nonResourceType: 'HumanName',
    systemTypes,
    choiceElements: [
      { type: 'Patient', element: 'deceased', typeNames: ['boolean', 'dateTime'] },
      { type: 'Observation', element: 'value', typeNames: observationTypes },
    ],
  });
  // https://hl7.org/fhir/R5/fhirpath.html#rules
  // https://hl7.org/fhir/R5/elementdefinition-definitions.html#ElementDefinition.contentReference
  describe(`generated ${provider.version} snapshot acceptance`, () => {
    it('exports the existing ModelProvider API', () => {
      expectTypeOf(provider).toEqualTypeOf<ModelProvider>();
    });
    it('covers every generated root and backbone', () => {
      // Resource and datatype roots in hl7.fhir.r4.core@4.0.1 and hl7.fhir.r5.core@5.0.0.
      // Update the numbers together with the pins in cli.ts.
      expect(rows.filter((row) => row[1] !== 'backbone')).toHaveLength(r5 ? 231 : 209);
      for (const [name] of rows) expect(provider.getType(name), name).toBeDefined();
    });
    it('resolves recursive and shared backbone content', () => {
      for (const [typeName, field, target] of [
        ['Questionnaire.item', 'item', 'Questionnaire.item'],
        ['QuestionnaireResponse.item', 'item', 'QuestionnaireResponse.item'],
        ['Bundle.entry', 'link', 'Bundle.link'],
        ['CodeSystem.concept', 'concept', 'CodeSystem.concept'],
      ]) {
        const type = provider.getType(typeName ?? '');
        expect(type).toBeDefined();
        if (type !== undefined)
          expect(provider.getElement(type, field ?? '')?.typeNames).toEqual([target]);
      }
    });
    it('preserves Resource-typed fields, primitive normalization and cardinality', () => {
      for (const [typeName, field, typeNames, isArray] of [
        ['Bundle.entry', 'resource', ['Resource'], false],
        ['Element', 'id', ['string'], false],
        ['Extension', 'url', ['uri'], false],
        ['HumanName', 'given', ['string'], true],
        ['Patient', 'contact', ['Patient.contact'], true],
      ] as const) {
        const type = provider.getType(typeName);
        expect(type).toBeDefined();
        if (type !== undefined)
          expect(provider.getElement(type, field)).toMatchObject({ typeNames, isArray });
      }
    });
    it('does not expose mutable data', () => {
      expect(Object.isFrozen(provider)).toBe(true);
      for (const [name] of rows) {
        const type = provider.getType(name);
        expect(Object.isFrozen(type), name).toBe(true);
        if (type === undefined) continue;
        expect(Object.isFrozen(provider.getElements(type)), name).toBe(true);
        for (const element of provider.getElements(type)) {
          expect(Object.isFrozen(element)).toBe(true);
          expect(Object.isFrozen(element.typeNames)).toBe(true);
        }
      }
    });
    it('rejects unknown and abstract resource roots', () => {
      for (const resourceType of [
        'Resource',
        'DomainResource',
        'Patient.contact',
        'patient',
        '__proto__',
      ]) {
        expect(provider.getRootType({ resourceType })).toBeUndefined();
      }
    });
  });
}
