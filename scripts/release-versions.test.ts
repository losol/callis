import { describe, expect, it } from 'vitest';
import {
  findReleaseVersionProblems,
  isBelowVersion,
  MINIMUM_RELEASE_VERSION,
} from './release-versions.ts';

// The release guard from RELEASING.md: nothing below 0.1.0 is published.
describe('isBelowVersion', () => {
  it.each([
    ['0.0.0', '0.1.0'],
    ['0.0.1', '0.1.0'],
    ['0.0.99', '0.1.0'],
    ['0.1.0-next.0', '0.1.0'],
    ['0.1.0-alpha', '0.1.0'],
    ['0.9.9', '1.0.0'],
    ['1.2.3', '1.10.0'],
  ])('puts %s below %s', (version, minimum) => {
    expect(isBelowVersion(version, minimum)).toBe(true);
  });

  it.each([
    ['0.1.0', '0.1.0'],
    ['0.1.1', '0.1.0'],
    ['0.2.0', '0.1.0'],
    ['1.0.0', '0.1.0'],
    ['0.1.0+build.5', '0.1.0'],
    ['0.10.0', '0.9.0'],
  ])('does not put %s below %s', (version, minimum) => {
    expect(isBelowVersion(version, minimum)).toBe(false);
  });

  it.each(['', '1', '0.1', 'v0.1.0', '01.0.0', '0.1.0.0', 'latest'])('rejects %j', (version) => {
    expect(() => isBelowVersion(version, MINIMUM_RELEASE_VERSION)).toThrow('Not a valid version');
  });
});

describe('findReleaseVersionProblems', () => {
  it('accepts public packages at 0.1.0 or later', () => {
    expect(
      findReleaseVersionProblems([
        { name: '@callis/core', version: '0.1.0', path: 'packages/core' },
        { name: '@callis/fhir-r4', version: '0.3.2', path: 'packages/fhir-r4' },
        { name: '@callis/ucum', version: '1.0.0', private: false, path: 'packages/ucum' },
      ]),
    ).toEqual([]);
  });

  it('rejects the 0.0.0 of a package that has never been versioned', () => {
    expect(
      findReleaseVersionProblems([
        { name: '@callis/core', version: '0.0.0', path: 'packages/core' },
      ]),
    ).toEqual([{ name: '@callis/core', version: '0.0.0', reason: 'is at 0.0.0, below 0.1.0' }]);
  });

  it("rejects 0.0.1, the placeholder's version, and a prerelease of 0.1.0", () => {
    const problems = findReleaseVersionProblems([
      { name: '@callis/core', version: '0.0.1', path: 'packages/core' },
      { name: '@callis/fhir-r4', version: '0.1.0-next.0', path: 'packages/fhir-r4' },
    ]);
    expect(problems.map((problem) => problem.name)).toEqual(['@callis/core', '@callis/fhir-r4']);
  });

  it('skips private projects, which are never published', () => {
    expect(
      findReleaseVersionProblems([
        { name: 'callis', private: true, path: '.' },
        { name: '@callis/site', version: '0.0.0', private: true, path: 'apps/site' },
        { name: '@callis/conformance', version: '0.0.0', private: true, path: 'tools/conformance' },
      ]),
    ).toEqual([]);
  });

  it('rejects a public project without a version or with an invalid one', () => {
    expect(
      findReleaseVersionProblems([
        { name: '@callis/a', path: 'packages/a' },
        { name: '@callis/b', version: 'next', path: 'packages/b' },
        { version: '0.0.0', path: 'packages/c' },
      ]),
    ).toEqual([
      { name: '@callis/a', version: undefined, reason: 'has no version' },
      { name: '@callis/b', version: 'next', reason: 'has an invalid version, "next"' },
      { name: 'packages/c', version: '0.0.0', reason: 'is at 0.0.0, below 0.1.0' },
    ]);
  });

  it('checks against another minimum', () => {
    expect(
      findReleaseVersionProblems(
        [{ name: '@callis/core', version: '0.4.0', path: 'packages/core' }],
        '1.0.0',
      ),
    ).toHaveLength(1);
  });
});
