import { describe, expect, it } from 'vitest';
import { validateArchive, validateManifest } from './source.ts';

const name = 'hl7.fhir.r6.core';
const version = '6.0.0-snapshot1';
const manifest = { name, version, license: 'CC0-1.0', fhirVersions: [version] };

describe('pinned source verification', () => {
  it('verifies exact bytes before extraction and rejects damaged cached bytes', () => {
    const emptySha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(() => validateArchive(new Uint8Array(), emptySha256, 'synthetic')).not.toThrow();
    expect(() => validateArchive(new Uint8Array([1]), emptySha256, 'synthetic')).toThrow(
      'Archive integrity mismatch',
    );
  });
  it('accepts the exact snapshot identity and CC0 source license', () => {
    expect(() => validateManifest(manifest, name, version)).not.toThrow();
  });
  it('preserves the pinned R4 legacy FHIR version manifest field', () => {
    expect(() =>
      validateManifest(
        {
          name: 'hl7.fhir.r4.core',
          version: '4.0.1',
          license: 'CC0-1.0',
          'fhir-version-list': ['4.0.1'],
        },
        'hl7.fhir.r4.core',
        '4.0.1',
      ),
    ).not.toThrow();
    expect(() =>
      validateManifest(
        { ...manifest, fhirVersions: undefined, 'fhir-version-list': [version] },
        name,
        version,
      ),
    ).toThrow('Unexpected package identity');
  });
  it.each([
    null,
    {},
    { ...manifest, name: 'hl7.fhir.r5.core' },
    { ...manifest, version: '6.0.0' },
    { ...manifest, license: 'MIT' },
    { ...manifest, fhirVersions: ['5.0.0'] },
    { ...manifest, fhirVersions: [version, '5.0.0'] },
    { ...manifest, fhirVersions: version },
    Object.create(manifest),
  ])('rejects an unexpected or inherited manifest: %j', (value: unknown) => {
    expect(() => validateManifest(value, name, version)).toThrow('Unexpected package identity');
  });
});
