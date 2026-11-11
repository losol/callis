import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findException, SUITE_EXCEPTIONS } from './exceptions.ts';
import { loadSuite, REPOSITORY_ROOT } from './fixtures.ts';
import { slug } from './report.ts';
import { allTests } from './suite.ts';

// Every exception needs its explanation in docs/spec-notes.md (testing guide, "Conformance suite").
describe('SUITE_EXCEPTIONS', () => {
  const notes = readFileSync(join(REPOSITORY_ROOT, 'docs', 'spec-notes.md'), 'utf8');
  const anchors = new Set(
    [...notes.matchAll(/^#{2,4} (.+)$/gm)].map((match) => slug((match[1] ?? '').replace(/`/g, ''))),
  );

  it.each(SUITE_EXCEPTIONS.map((exception) => [exception.note, exception] as const))(
    '%s links to a spec-notes heading and names tests that exist',
    (note, exception) => {
      expect(anchors.has(note)).toBe(true);
      for (const suite of exception.suites) {
        const ids = new Set(allTests(loadSuite(suite)).map((test) => test.id));
        for (const id of exception.tests) {
          expect(ids.has(id), `${suite}/${id}`).toBe(true);
        }
      }
    },
  );

  // https://hl7.org/fhirpath/STU3/ (Date/Time Arithmetic): R5 matches 3.0.0, so only R4 is excepted.
  it('excepts testPlusDate19 in R4 only', () => {
    expect(findException(SUITE_EXCEPTIONS, 'r4', 'testPlusDate19')).toBeDefined();
    expect(findException(SUITE_EXCEPTIONS, 'r5', 'testPlusDate19')).toBeUndefined();
  });

  // https://hl7.org/fhirpath/STU3/en/index.html#distinct--collection: undetermined equality means
  // distinct. Only the R5 file has these tests (docs/spec-notes.md#distinct-and-isdistinct).
  it.each(['testDistinct29', 'testDistinct36'])('excepts %s in R5', (id) => {
    expect(findException(SUITE_EXCEPTIONS, 'r5', id)?.note).toBe('distinct-and-isdistinct');
  });

  // https://hl7.org/fhirpath/STU3/en/#is-type-specifier: is on empty input is false, where N1
  // and the suite give empty (docs/spec-notes.md#is-on-empty-input-is-false).
  it('excepts testPolymorphismIsA3 in R4 and R5', () => {
    for (const suite of ['r4', 'r5'] as const) {
      expect(findException(SUITE_EXCEPTIONS, suite, 'testPolymorphismIsA3')?.note, suite).toBe(
        'is-on-empty-input-is-false',
      );
    }
  });

  // docs/spec-notes.md: the model-aware exceptions T0018 registers (#111), in both suites.
  it.each(['testFHIRPathAsFunction11', 'testFHIRPathAsFunction16', 'testType22'])(
    'excepts %s in R4 and R5',
    (id) => {
      for (const suite of ['r4', 'r5'] as const) {
        expect(findException(SUITE_EXCEPTIONS, suite, id)?.tests, suite).toContain(id);
      }
    },
  );
});
