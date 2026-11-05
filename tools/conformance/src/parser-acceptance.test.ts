import { describe, expect, it } from 'vitest';
import { FhirPathSyntaxError } from '../../../packages/core/src/errors/fhirpath-error.ts';
import { tokenize } from '../../../packages/core/src/lexer/lexer.ts';
import type { Token } from '../../../packages/core/src/lexer/token.ts';
import { parse } from '../../../packages/core/src/parser/parser.ts';
import { loadSuite } from './fixtures.ts';
import { allTests, SUITE_IDS, type SuiteTest } from './suite.ts';

// Parse-only acceptance of the vendored suites. Unlike the runner, which only talks to an
// EvaluatorAdapter (see adapter.ts), this test deliberately imports the engine's internal parser:
// it checks grammar coverage, not evaluation, and there is no public parse entry point before T0025.
// Syntax only: do not skip tests for missing converted inputs or unimplemented functions.
// https://hl7.org/fhirpath/N1/grammar.html
// https://hl7.org/fhirpath/N1/#operator-precedence
function exclusion(test: Pick<SuiteTest, 'group' | 'expression'>): string | undefined {
  if (test.group === 'documentFunctions' || test.group === 'cdaTests') return test.group;
  // Scan tokens, not strings: quoted text and comments must not exclude an expression.
  // Lexical errors still reach the syntax assertion below.
  try {
    const tokens = scopeTokens(test.expression);
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      const previous = tokens[index - 1];
      if (
        token?.kind === 'Identifier' &&
        token.value === 'L' &&
        previous?.kind === 'Number' &&
        previous.end === token.start
      )
        return 'T0028 Long literal';
      if (
        token?.kind === '{' &&
        tokens[index + 1]?.kind !== '}' &&
        (previous?.kind === 'Identifier' || previous?.kind === 'DelimitedIdentifier')
      )
        return 'T0031 instance selector';
    }
  } catch (error) {
    if (!(error instanceof FhirPathSyntaxError)) throw error;
  }
  return undefined;
}

// The phase-1 lexer has no ':' token. Inspect the valid prefix before a selector's colon.
// Other lexical failures still reach the parser assertion; quoted colons tokenize normally.
function scopeTokens(expression: string): readonly Token[] {
  try {
    return tokenize(expression);
  } catch (error) {
    if (
      error instanceof FhirPathSyntaxError &&
      error.code === 'syntax/unexpected-character' &&
      error.span !== undefined &&
      expression[error.span.start] === ':'
    ) {
      return tokenize(expression.slice(0, error.span.start));
    }
    throw error;
  }
}

for (const suite of SUITE_IDS) {
  const tests = allTests(loadSuite(suite));
  describe(`${suite} parse-only acceptance`, () => {
    for (const test of tests) {
      const reason = exclusion(test);
      if (reason !== undefined) {
        it.skip(`${test.id}: ${reason}`, () => {});
      } else {
        it(`${test.id}: ${test.expression}`, () => {
          if (suite === 'r5' && test.id === 'htmlTest01') {
            // Explicit suite/grammar mismatch; this is not a passing parse.
            // docs/spec-notes.md#reserved-div-in-an-html-fixture
            expect(test.expression).toBe('text.div.htmlChecks()');
            expect(() => parse(test.expression)).toThrow(FhirPathSyntaxError);
            expect(() => parse('text.`div`.htmlChecks()')).not.toThrow();
          } else if (test.invalid === 'syntax')
            expect(() => parse(test.expression)).toThrow(FhirPathSyntaxError);
          else expect(() => parse(test.expression)).not.toThrow();
        });
      }
    }
  });
}

// These document extension functions have wrong-arity syntax labels, but legal grammar.
// They are excluded above by group, not used to teach the parser function signatures.
// See docs/spec-notes.md#function-arity-is-not-a-grammar-error.
it.each(
  allTests(loadSuite('r5')).filter(
    (test) => test.group === 'documentFunctions' && test.invalid === 'syntax',
  ),
)('parses mislabelled extension call $id', (test) => {
  expect(() => parse(test.expression)).not.toThrow();
});

// Guard exclusions so future fixture updates cannot silently hide ordinary grammar errors.
it.each([
  ['1L', 'T0028 Long literal'],
  ["'1L'", undefined],
  ['1 /* L */', undefined],
  ['1 L', undefined],
  ['1`L`', undefined],
  ['Patient { name: 1 }', 'T0031 instance selector'],
  ['{}', undefined],
  ['{1}', undefined],
  ["'{x}'", undefined],
  ["'unterminated", undefined],
])('classifies phase-2 syntax without hiding %s', (expression, expected) => {
  expect(exclusion({ group: 'testLiterals', expression })).toBe(expected);
});

// The counts pin the vendored fixture versions in tools/conformance/fixtures. When the fixtures are
// refreshed, review the new exclusions and update the numbers here in the same PR.
it('keeps the pinned suite exceptions explicit', () => {
  const r4 = allTests(loadSuite('r4'));
  const r5 = allTests(loadSuite('r5'));
  expect(r4.filter((test) => exclusion(test) !== undefined)).toHaveLength(115);
  expect(r5.filter((test) => exclusion(test) !== undefined)).toHaveLength(118);
  expect(r5.filter((test) => test.id === 'htmlTest01')).toHaveLength(1);
  expect(
    r5
      .filter((test) => test.group === 'documentFunctions' && test.invalid === 'syntax')
      .map((test) => test.id),
  ).toEqual(['testSection13', 'testEntry12', 'testSameSubject16', 'testHasCoding10']);
});
