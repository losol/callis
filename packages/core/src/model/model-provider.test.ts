import { describe, expect, expectTypeOf, it } from 'vitest';
import { describeModelProviderContract } from '../../test/support/model-provider-contract.ts';
import { stubModel } from '../../test/support/stub-model.ts';
import type { ModelTypes } from '../types/model-types.ts';
import { choiceJsonName, type ModelProvider, type ModelTypeInfo } from './model-provider.ts';

describe('ModelProvider', () => {
  it('satisfies the part of a model that the type system uses', () => {
    expectTypeOf<ModelProvider>().toExtend<ModelTypes<ModelTypeInfo>>();
  });
});

// The contract suite that every provider should pass; the generated models are issue #56.
describeModelProviderContract(stubModel, {
  startTypes: ['Patient', 'Observation', 'Bundle', 'Age', 'Duration'],
  resourceType: 'Patient',
  nonResourceType: 'HumanName',
  systemTypes: [
    ['boolean', 'Boolean'],
    ['string', 'String'],
    ['code', 'String'], // a derived primitive
    ['integer', 'Integer'],
    ['positiveInt', 'Integer'],
    ['integer64', 'Long'],
    ['decimal', 'Decimal'],
    ['date', 'Date'], // not DateTime: docs/spec-notes.md
    ['dateTime', 'DateTime'],
    ['instant', 'DateTime'],
    ['time', 'Time'],
    ['Quantity', 'Quantity'],
    ['Age', 'Quantity'], // a specialization of Quantity
    ['Duration', 'Quantity'],
    ['HumanName', undefined],
    ['Patient', undefined],
    ['Element', undefined],
  ],
  choiceElements: [
    {
      type: 'Observation',
      element: 'value',
      typeNames: [
        'Quantity',
        'string',
        'boolean',
        'dateTime',
        'Period',
        'integer',
        'CodeableConcept',
      ],
    },
    { type: 'Patient', element: 'deceased', typeNames: ['boolean', 'dateTime'] },
    {
      type: 'Extension',
      element: 'value',
      typeNames: [
        'string',
        'boolean',
        'Quantity',
        'Age',
        'Duration',
        'dateTime',
        'integer',
        'decimal',
        'code',
        'Period',
      ],
    },
  ],
});

// https://hl7.org/fhir/R4/formats.html#choice: "[x]" is replaced with the title-cased type name.
describe('choiceJsonName', () => {
  it.each([
    ['value', 'Quantity', 'valueQuantity'],
    ['value', 'dateTime', 'valueDateTime'],
    ['value', 'string', 'valueString'],
    ['deceased', 'boolean', 'deceasedBoolean'],
    ['value', 'base64Binary', 'valueBase64Binary'],
  ])('names %s with type %s as %s', (name, typeName, expected) => {
    expect(choiceJsonName(name, typeName)).toBe(expected);
  });
});
