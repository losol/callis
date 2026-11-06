import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readEssence } from '../src/essence/essence-reader.ts';
import { UCUM_ESSENCE_XML } from '../src/essence/ucum-essence-xml.ts';
import { resolveUnit } from '../src/resolve-unit.ts';
import { buildUnitTable, EMPTY_UNIT_LOOKUP } from '../src/unit-table.ts';

interface SourceFile {
  readonly packagePath: string;
  readonly bytes: number;
  readonly sha256: string;
}

const packageFile = (path: string): Buffer => readFileSync(new URL(`../${path}`, import.meta.url));
const source = JSON.parse(packageFile('data/source.json').toString('utf8')) as {
  readonly commit: string;
  readonly files: Readonly<Record<string, SourceFile>>;
};
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('pinned UCUM files', () => {
  it.each(Object.entries(source.files))('%s matches its pinned size and SHA-256', (_, file) => {
    const bytes = packageFile(file.packagePath);
    expect(bytes.length).toBe(file.bytes);
    expect(sha256(bytes)).toBe(file.sha256);
  });

  it('embeds ucum-essence.xml byte for byte', () => {
    const file = packageFile('data/ucum-essence.xml');
    expect(Buffer.from(UCUM_ESSENCE_XML, 'latin1').equals(file)).toBe(true);
    expect(sha256(Buffer.from(UCUM_ESSENCE_XML, 'utf8'))).toBe(
      source.files['ucum-essence.xml']?.sha256,
    );
  });
});

describe('the pinned essence file', () => {
  const essence = readEssence(UCUM_ESSENCE_XML);
  const lookup = essence === undefined ? EMPTY_UNIT_LOOKUP : buildUnitTable(essence);
  const units = essence?.units ?? [];

  it('is read completely', () => {
    expect(essence?.version).toBe('2.2');
    expect(essence?.revisionDate).toBe('2024-06-17');
    expect(essence?.prefixes).toHaveLength(24);
    expect(essence?.baseUnits.map((unit) => unit.code)).toEqual([
      'm',
      's',
      'g',
      'rad',
      'K',
      'C',
      'cd',
    ]);
    expect(units).toHaveLength(305);
  });

  it('resolves every unit it defines', () => {
    const unresolved = units.filter((unit) => lookup.atom(unit.code) === undefined);
    expect(unresolved.map((unit) => unit.code)).toEqual([]);
  });

  it('converts only Cel and [degF] of its special units', () => {
    const special = units.filter((unit) => unit.isSpecial).map((unit) => unit.code);
    expect(special).toHaveLength(21);
    const affine = special.filter((code) => lookup.atom(code)?.special?.kind === 'affine');
    expect(affine).toEqual(['Cel', '[degF]']);
  });

  it('isolates every arbitrary unit', () => {
    const arbitrary = units.filter((unit) => unit.isArbitrary);
    expect(arbitrary).toHaveLength(41);
    for (const unit of arbitrary) {
      expect(lookup.atom(unit.code)?.dimension.get(unit.code)).toBe(1);
    }
  });

  // §4: with these tables, splitting off the longest prefix and reading the whole symbol as an
  // atom never disagree, and no prefixed symbol has two readings.
  it('has unambiguous prefixed symbols', () => {
    const atoms = [...(essence?.baseUnits ?? []), ...units].map((unit) => unit.code);
    const metric = atoms.filter((code) => lookup.isMetric(code));
    for (const code of atoms) {
      const splits = lookup.prefixCodes.filter(
        (prefix) => code.startsWith(prefix) && metric.includes(code.slice(prefix.length)),
      );
      expect(splits, code).toEqual([]);
    }
    for (const prefix of lookup.prefixCodes) {
      for (const atom of metric) {
        const symbol = prefix + atom;
        const readings = lookup.prefixCodes.filter(
          (other) => symbol.startsWith(other) && metric.includes(symbol.slice(other.length)),
        );
        expect(readings, symbol).toEqual([prefix]);
        expect(resolveUnit(symbol, lookup), symbol).toBeDefined();
      }
    }
  });
});
