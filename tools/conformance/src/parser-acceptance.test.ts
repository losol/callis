import { describe, expect, it } from 'vitest';
import { FhirPathSyntaxError } from '../../../packages/core/src/errors/fhirpath-error.ts';
import { tokenize } from '../../../packages/core/src/lexer/lexer.ts';
import { parse } from '../../../packages/core/src/parser/parser.ts';
import { loadSuite } from './fixtures.ts';
import { allTests, SUITE_IDS, type SuiteTest } from './suite.ts';

// Syntax only: do not skip tests for missing converted inputs or unimplemented functions.
// https://hl7.org/fhirpath/N1/grammar.html
// https://hl7.org/fhirpath/N1/#operator-precedence
function exclusion(test: SuiteTest): string | undefined {
  if (test.group === 'documentFunctions' || test.group === 'cdaTests') return test.group;
  // Scan tokens, not strings: quoted text and comments must not exclude an expression.
  // Lexical errors still reach the syntax assertion below.
  try {
    const tokens = tokenize(test.expression);
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
      if (token?.kind === '{' && tokens[index + 1]?.kind !== '}') return 'T0031 instance selector';
    }
  } catch (error) {
    if (!(error instanceof FhirPathSyntaxError)) throw error;
  }
  return undefined;
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
