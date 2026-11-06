import { describe, expect, it } from 'vitest';
import type { Atom } from './atom.ts';
import { readEssence } from './essence/essence-reader.ts';
import type { Rational } from './rational.ts';
import { resolveUnit } from './resolve-unit.ts';
import { buildUnitTable, EMPTY_UNIT_LOOKUP } from './unit-table.ts';

const unit = (code: string, definition: string, extra = ''): string =>
  `<unit Code="${code}" ${extra}><value Unit="${definition.split(' ')[1]}" value="${definition.split(' ')[0]}"/></unit>`;

// Invented units in the layout of ucum-essence.xml, to test resolution on its own.
const DOCUMENT = `<root>
  <prefix Code="k"><value value="1e3"/></prefix>
  <prefix Code="d"><value value="1e-1"/></prefix>
  <prefix Code="da"><value value="1e1"/></prefix>
  <base-unit Code="m" dim="L"/>
  <base-unit Code="s" dim="T"/>
  <base-unit Code="K" dim="C"/>
  ${unit('foo', '3 m', 'isMetric="yes"')}
  ${unit('bar', '2 foo/s')}
  ${unit('baz', '1 bar.s', 'isMetric="yes"')}
  ${unit('loopA', '1 loopB')}
  ${unit('loopB', '1 loopA')}
  ${unit('dangling', '1 nope')}
  ${unit('zero', '0 m')}
  ${unit('[arb]', '1 1', 'isArbitrary="yes"')}
  ${unit('[arb2]', '1 [arb]', 'isArbitrary="yes"')}
  <unit Code="[warm]" isSpecial="yes"><value Unit="cel(1 K)"><function name="Cel" value="1" Unit="K"/></value></unit>
  <unit Code="[hot]" isSpecial="yes"><value Unit="degf(5 K/9)"><function name="degF" value="5" Unit="K/9"/></value></unit>
  <unit Code="[loud]" isSpecial="yes"><value Unit="lg(1 1)"><function name="lg" value="1" Unit="1"/></value></unit>
  ${unit('[viaWarm]', '1 [warm]')}
</root>`;

const essence = readEssence(DOCUMENT);
const lookup = essence === undefined ? EMPTY_UNIT_LOOKUP : buildUnitTable(essence);

const ratio = (value: Rational | undefined): string | undefined =>
  value === undefined ? undefined : `${value.numerator}/${value.denominator}`;
const dimension = (atom: Atom | undefined): Record<string, number> | undefined =>
  atom === undefined ? undefined : Object.fromEntries(atom.dimension);

describe('buildUnitTable', () => {
  it('resolves definitions that refer to other units', () => {
    expect(ratio(lookup.atom('foo')?.magnitude)).toBe('3/1');
    expect(ratio(lookup.atom('bar')?.magnitude)).toBe('6/1');
    expect(dimension(lookup.atom('bar'))).toEqual({ m: 1, s: -1 });
    expect(ratio(lookup.atom('baz')?.magnitude)).toBe('6/1');
    expect(dimension(lookup.atom('baz'))).toEqual({ m: 1 });
    expect(lookup.atom('m')).toMatchObject({ isMetric: true, arbitrary: false });
  });

  it('leaves out circular, dangling and zero definitions', () => {
    for (const code of ['loopA', 'loopB', 'dangling', 'zero']) {
      expect(lookup.hasAtom(code)).toBe(false);
      expect(lookup.atom(code)).toBeUndefined();
    }
  });

  it('gives each arbitrary unit its own dimension', () => {
    expect(dimension(lookup.atom('[arb]'))).toEqual({ '[arb]': 1 });
    expect(dimension(lookup.atom('[arb2]'))).toEqual({ '[arb]': 1, '[arb2]': 1 });
    expect(lookup.atom('[arb2]')?.arbitrary).toBe(true);
  });

  it('keeps the affine offset of Cel and degF and marks other special units', () => {
    expect(lookup.atom('[warm]')?.special).toEqual({
      kind: 'affine',
      offset: { numerator: 5463n, denominator: 20n },
    });
    expect(ratio(lookup.atom('[hot]')?.magnitude)).toBe('5/9');
    expect(lookup.atom('[hot]')?.special).toEqual({
      kind: 'affine',
      offset: { numerator: 45967n, denominator: 100n },
    });
    expect(lookup.atom('[loud]')?.special).toEqual({ kind: 'unsupported' });
    // A definition that uses a special unit is not a proper unit.
    expect(lookup.atom('[viaWarm]')).toBeUndefined();
  });

  it('lists prefixes longest first', () => {
    expect(lookup.prefixCodes).toEqual(['da', 'd', 'k']);
  });
});

describe('resolveUnit', () => {
  const resolve = (text: string) => resolveUnit(text, lookup);

  it.each([
    ['kfoo', '3000/1', { m: 1 }],
    // §4■4: the longest prefix whose remainder is a metric atom.
    ['dafoo', '30/1', { m: 1 }],
    ['dfoo', '3/10', { m: 1 }],
    ['kfoo2', '9000000/1', { m: 2 }],
    ['foo/s', '3/1', { m: 1, s: -1 }],
    ['/s', '1/1', { s: -1 }],
    ['10.foo', '30/1', { m: 1 }],
    ['2+3.m', '8/1', { m: 1 }],
    ['m/(s.s)', '1/1', { m: 1, s: -2 }],
    ['{x}', '1/1', {}],
    ['foo{x}', '3/1', { m: 1 }],
  ])('resolves %s', (text, magnitude, dims) => {
    const resolved = resolve(text);
    expect(ratio(resolved?.magnitude)).toBe(magnitude);
    expect(Object.fromEntries(resolved?.dimension ?? [])).toEqual(dims);
  });

  it('keeps simple units and integer factors apart for unit algebra', () => {
    expect(resolve('10.kfoo2/s')).toMatchObject({
      scalar: { numerator: 10n, denominator: 1n },
      terms: [
        { symbol: 'kfoo', exponent: 2 },
        { symbol: 's', exponent: -1 },
      ],
    });
  });

  it.each([
    ['an unknown atom', 'nope'],
    ['a prefix on a non-metric atom', 'kbar'],
    ['a prefix alone', 'k'],
    ['a zero factor', '0.m'],
    ['a magnitude beyond the size bound', 'kfoo99999'],
    ['invalid syntax', 'm//s'],
  ])('rejects %s', (_, text) => {
    expect(resolve(text)).toBeUndefined();
  });

  it('keeps the scale only of a lone special unit', () => {
    expect(resolve('[warm]')?.special?.kind).toBe('affine');
    expect(resolve('[warm]{body}')?.special?.kind).toBe('affine');
    expect(resolve('[loud]')?.special?.kind).toBe('unsupported');
    for (const text of ['[warm]2', '/[warm]', '[warm].m', 'm/[warm]', '2.[warm]', '([warm])']) {
      expect(resolve(text)?.special?.kind).toBe('unsupported');
    }
  });

  it('marks terms with arbitrary units', () => {
    expect(resolve('[arb]/m')?.arbitrary).toBe(true);
    expect(resolve('foo/m')?.arbitrary).toBe(false);
  });
});

describe('EMPTY_UNIT_LOOKUP', () => {
  it('knows no unit', () => {
    expect(resolveUnit('m', EMPTY_UNIT_LOOKUP)).toBeUndefined();
    expect(resolveUnit('{x}', EMPTY_UNIT_LOOKUP)?.dimension.size).toBe(0);
  });
});
