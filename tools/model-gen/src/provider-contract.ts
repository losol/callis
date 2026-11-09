import type { ModelProvider, SystemTypeName } from '@callis/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { describeModelProviderContract } from '../../../packages/core/test/support/model-provider-contract.ts';
import type { TypeRow } from '../runtime/provider.ts';

/** Source-specific acceptance expectations for a newly pinned model release. */
export interface GeneratedProviderExpectations {
  readonly rootCount: number;
  readonly observationTypes: readonly string[];
  readonly hasInteger64: boolean;
}

/** Applies the existing core contract and acceptance tests to every generated root. */
export function describeGeneratedProvider(
  provider: ModelProvider,
  rows: readonly TypeRow[],
  expectations?: GeneratedProviderExpectations,
): void {
  const r5 = provider.version === '5.0.0';
  if (expectations === undefined && !r5 && provider.version !== '4.0.1') {
    throw new Error(`Explicit snapshot expectations required for ${provider.version}`);
  }
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
      ...((expectations?.hasInteger64 ?? r5)
        ? [['integer64', 'Long'] as const, ['PrimitiveType', undefined] as const]
        : []),
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
      {
        type: 'Observation',
        element: 'value',
        typeNames: expectations?.observationTypes ?? observationTypes,
      },
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
      expect(rows.filter((row) => row[1] !== 'backbone')).toHaveLength(
        expectations?.rootCount ?? (r5 ? 231 : 209),
      );
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
        ['Resource', 'id', ['id'], false],
        ['Patient', 'id', ['id'], false],
        ['Element', 'id', ['string'], false],
        ['Address', 'id', ['string'], false],
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
    // https://hl7.org/fhir/R4/resource-definitions.html#Resource.id is an id (as in R5 and R6),
    // https://hl7.org/fhir/R4/element-definitions.html#Element.id a string; every element
    // inherits one or the other, whatever its snapshot copy says (docs/spec-notes.md).
    it('types the id of every resource as id and every other id as string', () => {
      for (const [name, kind] of rows) {
        const type = provider.getType(name);
        // R5 and R6 add Base, the root of the model, which has no elements.
        if (name === 'Base') {
          expect(type && provider.getElements(type)).toEqual([]);
          continue;
        }
        const id = type === undefined ? undefined : provider.getElement(type, 'id');
        expect(id?.typeNames, name).toEqual(kind === 'resource' ? ['id'] : ['string']);
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
