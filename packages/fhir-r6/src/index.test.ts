import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describeGeneratedProvider } from '../../../tools/model-gen/src/provider-contract.ts';
import { r6 } from './index.ts';
import { modelData } from './model-data.ts';

describeGeneratedProvider(r6, modelData, {
  rootCount: 196,
  hasInteger64: true,
  // https://hl7.org/fhir/6.0.0-snapshot1/observation-definitions.html#Observation.value_x_
  observationTypes: [
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
    'Attachment',
  ],
});

describe('FHIR R6 September 2026 draft snapshot', () => {
  it('reports its exact prerelease version', () => {
    expect(r6.version).toBe('6.0.0-snapshot1');
  });
  it('matches the complete generated inventory, including abstract types and backbones', () => {
    const inventory: unknown = JSON.parse(
      readFileSync(new URL('../inventory.json', import.meta.url), 'utf8'),
    );
    expect(inventory).toEqual({
      source: 'hl7.fhir.r6.core@6.0.0-snapshot1',
      total: 683,
      types: Object.fromEntries(
        (['resource', 'complex', 'primitive', 'backbone'] as const).map((kind) => [
          kind,
          modelData.filter((row) => row[1] === kind).map((row) => row[0]),
        ]),
      ),
    });
    expect(
      ['resource', 'complex', 'primitive', 'backbone'].map(
        (kind) => modelData.filter((row) => row[1] === kind).length,
      ),
    ).toEqual([124, 51, 21, 487]);
  });
  // https://hl7.org/fhir/6.0.0-snapshot1/devicealert-definitions.html#DeviceAlert
  it('models the new DeviceAlert resource with inherited and repeating backbone fields', () => {
    const type = r6.getType('DeviceAlert');
    const resource = r6.getType('DomainResource');
    expect(type).toMatchObject({ kind: 'resource', baseName: 'DomainResource', isAbstract: false });
    expect(r6.getRootType({ resourceType: 'DeviceAlert' })).toBe(type);
    if (type === undefined || resource === undefined) throw new Error('Missing R6 resource');
    expect(r6.isSubtypeOf(type, resource)).toBe(true);
    expect(r6.getElement(type, 'id')).toMatchObject({ typeNames: ['string'], isArray: false });
    expect(r6.getElement(type, 'signal')).toMatchObject({
      typeNames: ['DeviceAlert.signal'],
      isArray: true,
      isChoice: false,
    });
    expect(r6.getType('DeviceAlert.signal')).toMatchObject({
      kind: 'backbone',
      baseName: 'BackboneElement',
    });
  });
  // https://hl7.org/fhir/6.0.0-snapshot1/datatypes-definitions.html#RelativeTime.offset_x_
  it('models the new RelativeTime datatype and its Duration/Range choice', () => {
    const type = r6.getType('RelativeTime');
    expect(type).toMatchObject({ kind: 'complex', baseName: 'BackboneType' });
    if (type === undefined) throw new Error('Missing R6 datatype');
    expect(r6.getElement(type, 'offset')).toMatchObject({
      typeNames: ['Duration', 'Range'],
      isChoice: true,
      isArray: false,
    });
    expect(r6.getElement(type, 'offsetDuration')).toBeUndefined();
  });
  it('does not retain R5 roots absent from the pinned R6 core package', () => {
    for (const name of ['DeviceUsage', 'StructureMap', 'MolecularSequence', 'Contributor']) {
      expect(r6.getType(name), name).toBeUndefined();
    }
  });
  // https://hl7.org/fhir/6.0.0-snapshot1/dosage-definitions.html#DosageDetails.step
  it('models DosageDetails inline steps with their Element base', () => {
    const type = r6.getType('DosageDetails');
    expect(type).toMatchObject({ kind: 'complex', baseName: 'BackboneType' });
    if (type === undefined) throw new Error('Missing R6 DosageDetails');
    expect(r6.getElement(type, 'step')).toMatchObject({
      typeNames: ['DosageDetails.step'],
      isArray: true,
    });
    expect(r6.getType('DosageDetails.step')).toMatchObject({
      kind: 'backbone',
      baseName: 'Element',
    });
  });
});
