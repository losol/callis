import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  containerReference,
  exactDecimal,
  expressionError,
  filteredGiven,
  filteredNameCount,
  firstGiven,
  given,
  hasAda,
  inHours,
  lossless,
  managedBy,
  named,
  numberOfNames,
  onlyName,
  parsedDecimal,
  patient,
  quantityJson,
  selectedGiven,
  variable,
} from '../../../examples/public-api.ts';

describe('public guide examples', () => {
  it('runs the quick start, exact rendering and error examples', () => {
    expect(given).toEqual(['Ada', 'Mina']);
    expect(firstGiven).toEqual(['Ada']);
    expect(filteredGiven).toEqual(['Ada', 'Mina']);
    expect(numberOfNames).toEqual([1]);
    expect(hasAda).toEqual([true]);
    expect(filteredNameCount).toEqual([1]);
    expect(selectedGiven).toEqual(['Ada']);
    expect(onlyName).toEqual(patient.name);
    expect(onlyName[0]).toBe(patient.name[0]);
    expect(named).toEqual(['named']);
    expect(parsedDecimal).toEqual(['1.50']);
    expect(inHours).toEqual(["96 'h'"]);
    expect(exactDecimal).toEqual(['9007199254740993.1200']);
    expect(quantityJson).toBe(
      '[{"value":"1.200","unit":"mg","system":"http://unitsofmeasure.org","code":"mg"}]',
    );
    expect(variable).toEqual(['hello']);
    expect(lossless).toEqual(['1.50']);
    expect(managedBy).toEqual(['Acme']);
    expect(containerReference).toEqual(['#o1']);
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
