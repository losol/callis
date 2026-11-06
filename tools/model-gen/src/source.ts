import { createHash } from 'node:crypto';

/** Verifies cached and downloaded bytes before any archive is extracted. */
export function validateArchive(bytes: Uint8Array, sha256: string, source: string): void {
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
    throw new Error(
      `Archive integrity mismatch for ${source}; remove the cached archive and retry`,
    );
  }
}

/** Fails closed on a substituted package, version, FHIR version or source license. */
export function validateManifest(manifest: unknown, packageName: string, version: string): void {
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !Object.hasOwn(manifest, 'name') ||
    !('name' in manifest) ||
    manifest.name !== packageName ||
    !Object.hasOwn(manifest, 'version') ||
    !('version' in manifest) ||
    manifest.version !== version ||
    !Object.hasOwn(manifest, 'license') ||
    !('license' in manifest) ||
    manifest.license !== 'CC0-1.0'
  ) {
    throw new Error(
      `Unexpected package identity, FHIR version or license: ${packageName}@${version}`,
    );
  }
  // The pinned R4 archive predates the fhirVersions spelling used by R5/R6.
  const legacy = packageName === 'hl7.fhir.r4.core';
  const key = legacy ? 'fhir-version-list' : 'fhirVersions';
  const versions = legacy
    ? 'fhir-version-list' in manifest
      ? manifest['fhir-version-list']
      : undefined
    : 'fhirVersions' in manifest
      ? manifest.fhirVersions
      : undefined;
  if (
    !Object.hasOwn(manifest, key) ||
    !Array.isArray(versions) ||
    versions.length !== 1 ||
    versions[0] !== version
  ) {
    throw new Error(
      `Unexpected package identity, FHIR version or license: ${packageName}@${version}`,
    );
  }
}
