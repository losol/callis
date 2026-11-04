import { describe, expect, expectTypeOf, it } from 'vitest';
import * as api from './index.ts';
import type { ModelProvider as InternalModelProvider } from './model/model-provider.ts';

describe('@callis/core public API', () => {
  it('has no runtime exports yet', () => {
    expect(Object.keys(api)).toEqual([]);
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
