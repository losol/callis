import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  exactDecimal,
  expressionError,
  filteredGiven,
  firstGiven,
  given,
  quantityJson,
  variable,
} from '../../../examples/public-api.ts';

describe('public guide examples', () => {
  it('runs the quick start, exact rendering and error examples', () => {
    expect(given).toEqual(['Ada', 'Mina']);
    expect(firstGiven).toEqual(['Ada']);
    expect(filteredGiven).toEqual(['Ada', 'Mina']);
    expect(exactDecimal).toEqual(['9007199254740993.1200']);
    expect(quantityJson).toBe(
      '[{"value":"1.200","unit":"mg","system":"http://unitsofmeasure.org","code":"mg"}]',
    );
    expect(variable).toEqual(['hello']);
    expect(expressionError()).toContain('syntax/unexpected-token');
  });

  it('keeps every documented TypeScript snippet in the executable example', () => {
    const root = new URL('../../../', import.meta.url);
    const example = readFileSync(new URL('examples/public-api.ts', root), 'utf8');
    for (const path of ['README.md', 'packages/core/README.md', 'docs/guide.md']) {
      const text = readFileSync(new URL(path, root), 'utf8');
      for (const block of text.matchAll(/```ts\n([\s\S]*?)```/g)) {
        // Ignore formatting-only whitespace, commas and semicolons in the shared snippets.
        const normalize = (code: string): string => code.replace(/[\s,;]/g, '');
        expect(normalize(example), fileURLToPath(new URL(path, root))).toContain(
          normalize(block[1] ?? ''),
        );
      }
    }
  });
});
