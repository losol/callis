import { describe, expect, it } from 'vitest';

import {
  type ConformanceTests,
  conformanceFromBaseline,
  parseBaselineIds,
  parseTestResults,
} from './conformance.ts';

const results = JSON.stringify({
  adapter: '@callis/core (internal API)',
  fixtures: 'cb4eac4',
  results: [
    { suite: 'r4', id: 'a', phase: 'phase1', status: 'pass' },
    { suite: 'r4', id: 'b', phase: 'phase1', status: 'fail' },
    { suite: 'r4', id: 'c', phase: 'stu', status: 'fail' },
    { suite: 'r4', id: 'd', phase: 'unsupported', status: 'skip' },
    { suite: 'r5', id: 'a', phase: 'phase1', status: 'pass' },
  ],
});

describe('parseTestResults', () => {
  it('counts the tests of each suite and lists the Phase 1 ones', () => {
    expect(parseTestResults(results)).toEqual({
      adapter: '@callis/core (internal API)',
      suites: {
        r4: { total: 4, phase1: new Set(['a', 'b']) },
        r5: { total: 1, phase1: new Set(['a']) },
      },
    });
  });

  it.each([
    ['no results', '{"adapter":"x"}'],
    ['no adapter', '{"results":[]}'],
    ['a result without an ID', '{"adapter":"x","results":[{"suite":"r4"}]}'],
    ['a list', '[]'],
  ])('rejects %s', (_name, json) => {
    expect(() => parseTestResults(json)).toThrow(/conformance result/i);
  });
});

describe('parseBaselineIds', () => {
  it('reads one ID per line, in any order, ignoring blank lines and repeats', () => {
    expect(parseBaselineIds('b\na\n\nb\r\nc#2\n')).toEqual(new Set(['a', 'b', 'c#2']));
  });

  it('is empty for an empty file', () => {
    expect(parseBaselineIds('')).toEqual(new Set());
  });
});

describe('conformanceFromBaseline', () => {
  const tests: ConformanceTests = parseTestResults(results);

  it('counts the passing tests, and the Phase 1 ones against the suite of the checkout', () => {
    // `x` left the suite after the commit; it still counts as a pass at that commit.
    expect(conformanceFromBaseline({ r4: 'a\nc\nx\n', r5: '' }, tests)).toEqual({
      adapter: '@callis/core (internal API)',
      suites: {
        r4: { total: 4, passed: 3, phase1: { total: 2, passed: 1 } },
        r5: { total: 1, passed: 0, phase1: { total: 1, passed: 0 } },
      },
    });
  });

  it('leaves out the failed and skipped counts that the baseline does not tell', () => {
    const suite = conformanceFromBaseline({ r4: 'a\n' }, tests)?.suites.r4;
    expect(suite).toBeDefined();
    expect(suite).not.toHaveProperty('failed');
    expect(suite?.phase1).not.toHaveProperty('skipped');
  });

  it('skips a suite that the checkout does not know', () => {
    expect(conformanceFromBaseline({ r6: 'a\n' }, tests)).toBeNull();
    expect(conformanceFromBaseline({ constructor: 'a\n' }, tests)).toBeNull();
  });

  it('is null without a baseline', () => {
    expect(conformanceFromBaseline({}, tests)).toBeNull();
  });
});
