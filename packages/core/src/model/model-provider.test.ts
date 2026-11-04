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
  startTypes: ['Patient', 'Observation', 'Age'],
  resourceType: 'Patient',
  nonResourceType: 'HumanName',
  systemTypes: [
    ['boolean', 'Boolean'],
    ['string', 'String'],
    ['code', 'String'], // a derived primitive
    ['integer', 'Integer'],
    ['decimal', 'Decimal'],
    ['date', 'Date'], // not DateTime: docs/spec-notes.md
    ['dateTime', 'DateTime'],
    ['Quantity', 'Quantity'],
    ['Age', 'Quantity'], // a specialization of Quantity
    ['HumanName', undefined],
    ['Patient', undefined],
    ['Element', undefined],
  ],
  choiceElements: [
    { type: 'Observation', element: 'value', typeNames: ['Quantity', 'string', 'boolean'] },
    { type: 'Extension', element: 'value', typeNames: ['string', 'boolean', 'Quantity'] },
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
