import { evaluate } from '@callis/core';
import { describe, expect, it } from 'vitest';

import { exampleInput, examples } from './examples';

describe('playground presets', () => {
  // Navigation/indexing: https://hl7.org/fhirpath/N1/#path-selection
  // Decimal arithmetic: https://hl7.org/fhirpath/N1/#math
  it.each(examples)('$name runs through the public API', ({ expression, expected }) => {
    expect(evaluate(JSON.parse(exampleInput), expression, { decimalOutput: 'string' })).toEqual(
      expected,
    );
  });
});
