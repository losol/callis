import { describe, expect, it } from 'vitest';

import { parseAdapterName, parseConformanceReport, sumGrepCounts } from './git.ts';

describe('sumGrepCounts', () => {
  const output = [
    'abc:packages/core/src/a.ts:10',
    'abc:packages/core/src/a.test.ts:30',
    'abc:packages/core/src/b.ts:5',
    '',
  ].join('\n');

  it('sums the counts and the files', () => {
    expect(sumGrepCounts(output)).toEqual({ count: 45, files: 3 });
  });

  it('skips the files the filter rejects', () => {
    const sourceOnly = (path: string) => path.endsWith('.ts') && !path.endsWith('.test.ts');
    expect(sumGrepCounts(output, sourceOnly)).toEqual({ count: 15, files: 2 });
  });

  it('is empty for no output', () => {
    expect(sumGrepCounts('')).toEqual({ count: 0, files: 0 });
  });
});

const report = `# FHIRPath conformance: R4 suite

Results of [\`tests-fhir-r4.xml\`](x), evaluated with the **stub (no engine yet)** adapter.

## Summary

| Phase | Tests | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Phase 1 | 934 | 12 | 22 | 900 |
| STU | 142 | 0 | 74 | 68 |
| Unsupported | 115 | 0 | 0 | 115 |
| **Total** | 1191 | 12 | 96 | 1083 |

## Groups

| Group | Phase | Tests | Passed | Failed | Skipped |
| --- | --- | ---: | ---: | ---: | ---: |
| \`comments\` | Phase 1 | 9 | 0 | 0 | 9 |
`;

describe('parseConformanceReport', () => {
  it('reads the Total and Phase 1 rows of the summary table', () => {
    expect(parseConformanceReport(report)).toEqual({
      total: 1191,
      passed: 12,
      failed: 96,
      skipped: 1083,
      phase1: { total: 934, passed: 12, failed: 22, skipped: 900 },
    });
  });

  it('is null for a document without a summary table', () => {
    expect(parseConformanceReport('# Nothing here')).toBeNull();
  });

  it('reads the adapter the report names', () => {
    expect(parseAdapterName(report)).toBe('stub (no engine yet)');
    expect(parseAdapterName('no adapter')).toBeNull();
  });
});
