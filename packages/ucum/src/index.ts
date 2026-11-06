/**
 * Public API of `@callis/ucum`: full UCUM unit conversion for Callis.
 *
 * The package embeds the unchanged UCUM essence file (`ucum-essence.xml`, under the UCUM license;
 * see `SOURCE.md`) and reads it once, when this module is first imported. The code is MIT
 * licensed and has no runtime dependencies besides its `@callis/core` peer.
 *
 * @packageDocumentation
 */
import type { UnitSystem } from '@callis/core';
import type { UnitLookup } from './atom.ts';
import { readEssence } from './essence/essence-reader.ts';
import { UCUM_ESSENCE_XML } from './essence/ucum-essence-xml.ts';
import { createUcumUnitSystem } from './ucum-unit-system.ts';
import { buildUnitTable, EMPTY_UNIT_LOOKUP } from './unit-table.ts';

/**
 * A `UnitSystem` with the full UCUM: prefixes, every unit of the essence file, unit expressions
 * such as `mg/dL` or `kg.m/s2`, annotations, `10*n` and `10^n`. Commensurable units convert
 * exactly; `Cel` and `[degF]` convert on their offset scales; arbitrary units and other special
 * units only match the identical unit. Calendar keywords keep the rules of the minimal unit
 * system in `@callis/core`. Unknown or invalid units give `undefined`; nothing throws.
 *
 * @example
 * ```ts
 * import { Decimal } from '@callis/core';
 * import { ucum } from '@callis/ucum';
 *
 * ucum.convert(Decimal.ONE, 'mg/dL', 'g/L')?.toString(); // '0.01'
 * ucum.compare?.(Decimal.ONE, 'kg', Decimal.of(1000n), 'g'); // 0
 * ```
 * @see https://ucum.org/ucum
 * @see https://hl7.org/fhirpath/STU3/#quantity
 */
export const ucum: UnitSystem = /* @__PURE__ */ createUcumUnitSystem(
  /* @__PURE__ */ loadUnitTable(),
);

function loadUnitTable(): UnitLookup {
  const essence = readEssence(UCUM_ESSENCE_XML);
  // The embedded file is fixed and checked by the tests, so this fallback is defensive only.
  return essence === undefined ? EMPTY_UNIT_LOOKUP : buildUnitTable(essence);
}
