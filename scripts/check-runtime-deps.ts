/**
 * Fails if a package that must stay dependency-free declares runtime dependencies
 * (ADR-0009: `@callis/core` has no runtime dependencies; ADR-0007: neither has `@callis/ucum`).
 */
import { listPackages } from './packages.ts';

const ZERO_DEPENDENCY_PACKAGES: ReadonlySet<string> = new Set([
  '@callis/core',
  '@callis/fhir-r4',
  '@callis/fhir-r5',
  '@callis/ucum',
]);

const failures: string[] = [];
for (const { manifest } of listPackages()) {
  if (!ZERO_DEPENDENCY_PACKAGES.has(manifest.name)) {
    continue;
  }
  const runtimeDependencies = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...(manifest.bundleDependencies ?? manifest.bundledDependencies ?? []),
  ];
  if (runtimeDependencies.length > 0) {
    failures.push(
      `${manifest.name} must not have runtime dependencies: ${runtimeDependencies.join(', ')}`,
    );
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`✗ ${failure}`);
  }
  console.error('See docs/adr/0009-esm-only-zero-deps.md.');
  process.exit(1);
}
console.log(`✓ No runtime dependencies in ${[...ZERO_DEPENDENCY_PACKAGES].join(', ')}`);
