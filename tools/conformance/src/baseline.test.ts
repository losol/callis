import { describe, expect, it } from 'vitest';
import {
  type Baseline,
  checkRatchet,
  formatRefs,
  parseBaseline,
  type RatchetMode,
  type RatchetResult,
  ratchetFails,
  serializeBaseline,
  updateBaseline,
} from './baseline.ts';
import { makeRun } from './test-helpers.ts';

const baseline: Baseline = { r4: [], r5: ['a', 'b', 'gone'] };
const run = makeRun('r5', [
  ['a', 'pass'],
  ['b', 'fail'],
  ['c', 'pass'],
  ['d', 'skip'],
]);

describe('checkRatchet', () => {
  it('finds regressions, new passes and tests that left the suite', () => {
    expect(checkRatchet(baseline, [run])).toEqual({
      regressions: [{ suite: 'r5', id: 'b' }],
      newPasses: [{ suite: 'r5', id: 'c' }],
      vanished: [{ suite: 'r5', id: 'gone' }],
      excluded: [],
    });
  });

  it('counts a baseline test skipped for a missing input as a regression', () => {
    const skipped = makeRun('r5', [['a', 'skip', { skipCause: 'input' }]]);
    expect(checkRatchet({ r4: [], r5: ['a'] }, [skipped]).regressions).toEqual([
      { suite: 'r5', id: 'a' },
    ]);
  });

  it.each(['exception', 'unsupported'] as const)(
    'counts a baseline test skipped as %s as excluded, not as a regression',
    (skipCause) => {
      const skipped = makeRun('r5', [['a', 'skip', { skipCause }]]);
      const ratchet = checkRatchet({ r4: [], r5: ['a'] }, [skipped]);
      expect(ratchet.regressions).toEqual([]);
      expect(ratchet.excluded).toEqual([{ suite: 'r5', id: 'a' }]);
    },
  );

  it('ignores suites that were not run', () => {
    expect(checkRatchet({ r4: ['x'], r5: [] }, [makeRun('r5', [])])).toEqual({
      regressions: [],
      newPasses: [],
      vanished: [],
      excluded: [],
    });
  });
});

describe('updateBaseline', () => {
  it('refuses to record a regression', () => {
    expect(() => updateBaseline(baseline, [run])).toThrow(
      'Refusing to update the baseline: 1 baseline test(s) no longer pass (r5/b)',
    );
  });

  it('records the passing tests, sorted, and drops tests that left the suite', () => {
    const next = updateBaseline({ r4: ['keep'], r5: ['a', 'gone'] }, [
      makeRun('r5', [
        ['c', 'pass'],
        ['a', 'pass'],
        ['b', 'fail'],
      ]),
    ]);
    expect(next).toEqual({ r4: ['keep'], r5: ['a', 'c'] });
  });

  it('drops baseline tests that are now an exception', () => {
    const excepted = makeRun('r5', [
      ['a', 'pass'],
      ['b', 'skip', { skipCause: 'exception' }],
    ]);
    expect(updateBaseline({ r4: [], r5: ['a', 'b'] }, [excepted])).toEqual({ r4: [], r5: ['a'] });
  });
});

describe('ratchetFails', () => {
  const ref = [{ suite: 'r5' as const, id: 't' }];
  const clean: RatchetResult = { regressions: [], newPasses: [], vanished: [], excluded: [] };
  const cases: readonly (readonly [string, RatchetResult])[] = [
    ['nothing to record', clean],
    ['a regression', { ...clean, regressions: ref }],
    ['a test that left the suite', { ...clean, vanished: ref }],
    ['a test that is now excluded', { ...clean, excluded: ref }],
    ['an unrecorded pass', { ...clean, newPasses: ref }],
  ];
  // Expected exit status per mode: [report, update, check].
  const expected: Readonly<Record<string, readonly [boolean, boolean, boolean]>> = {
    'nothing to record': [false, false, false],
    'a regression': [true, true, true],
    'a test that left the suite': [false, false, true],
    'a test that is now excluded': [false, false, true],
    'an unrecorded pass': [false, false, true],
  };
  const modes: readonly RatchetMode[] = ['report', 'update', 'check'];

  it.each(cases)('with %s', (name, ratchet) => {
    expect(modes.map((mode) => ratchetFails(mode, ratchet))).toEqual(expected[name]);
  });
});

describe('baseline.json', () => {
  it('round-trips, one test per line', () => {
    const text = serializeBaseline({ r4: ['b', 'a'], r5: [] });
    expect(text).toContain('"r4": [\n    "a",\n    "b"\n  ]');
    expect(parseBaseline(text)).toEqual({ r4: ['a', 'b'], r5: [] });
  });

  it('rejects a malformed file', () => {
    expect(() => parseBaseline('{"r4": [1], "r5": []}')).toThrow('"r4" must be an array');
    expect(() => parseBaseline('{"r4": []}')).toThrow('"r5" must be an array');
  });
});

describe('formatRefs', () => {
  it('lists at most ten tests', () => {
    const refs = Array.from({ length: 12 }, (_, i) => ({ suite: 'r4' as const, id: `t${i}` }));
    expect(formatRefs(refs)).toBe(
      'r4/t0, r4/t1, r4/t2, r4/t3, r4/t4, r4/t5, r4/t6, r4/t7, r4/t8, r4/t9, …',
    );
  });
});
