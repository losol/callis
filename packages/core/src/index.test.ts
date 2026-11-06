import { describe, expect, expectTypeOf, it } from 'vitest';
import * as api from './index.ts';
import type { ModelProvider as InternalModelProvider } from './model/model-provider.ts';
import { Decimal, MAX_DECIMAL_DIGITS } from './values/decimal/decimal.ts';
import type { UnitSystem as InternalUnitSystem } from './values/quantity/unit-system.ts';
import { minimalUnitSystem } from './values/quantity/unit-system.ts';

describe('@callis/core public API', () => {
  it('exports the minimal facade, errors, Decimal and unit system at runtime', () => {
    // Unit packages such as @callis/ucum implement UnitSystem with Decimal values (T0007).
    expect(Object.keys(api).sort()).toEqual(
      [
        'Decimal',
        'MAX_DECIMAL_DIGITS',
        'minimalUnitSystem',
        'compile',
        'evaluate',
        'FhirPathError',
        'FhirPathSyntaxError',
        'FhirPathSemanticError',
        'FhirPathEvaluationError',
      ].sort(),
    );
    expect(api.Decimal).toBe(Decimal);
    expect(api.MAX_DECIMAL_DIGITS).toBe(MAX_DECIMAL_DIGITS);
    expect(api.minimalUnitSystem).toBe(minimalUnitSystem);
  });

  it('exports the UnitSystem contract types', () => {
    expectTypeOf<api.UnitSystem>().toEqualTypeOf<InternalUnitSystem>();
    expectTypeOf<api.UnitProduct['factor']>().toEqualTypeOf<Decimal>();
    expectTypeOf<api.ParsedUnit['unit']>().toEqualTypeOf<string>();
    expectTypeOf<api.UnitConversionOptions['explicit']>().toEqualTypeOf<boolean | undefined>();
  });

  it('exports the types a data model implements', () => {
    expectTypeOf<api.ModelProvider>().toEqualTypeOf<InternalModelProvider>();
    expectTypeOf<api.ModelTypeInfo['kind']>().toEqualTypeOf<api.ModelTypeKind>();
    expectTypeOf<api.ElementInfo['typeNames']>().toEqualTypeOf<readonly string[]>();
    expectTypeOf<ReturnType<api.ModelProvider['getSystemType']>>().toEqualTypeOf<
      Exclude<api.SystemTypeName, 'Any'> | undefined
    >();
  });
});
