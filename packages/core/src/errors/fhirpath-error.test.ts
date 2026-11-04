import { describe, expect, it } from 'vitest';
import {
  FhirPathError,
  FhirPathEvaluationError,
  FhirPathSemanticError,
  FhirPathSyntaxError,
} from './fhirpath-error.ts';
import { spanFromOffsets } from './source-span.ts';

describe('FhirPathError.format', () => {
  // The documented example in docs/tasks/T0000-scaffold.md#errors-and-diagnostics.
  it('formats a syntax error with a caret under the span', () => {
    const expression = "Patient.name.where(use = 'official'";
    const error = new FhirPathSyntaxError(
      'syntax/unexpected-token',
      "Expected ')' but found end of input",
      { expression, span: spanFromOffsets(expression, expression.length) },
    );

    expect(error.format()).toBe(
      [
        "FhirPathSyntaxError [syntax/unexpected-token]: Expected ')' but found end of input",
        "  Patient.name.where(use = 'official'",
        '                                     ^',
      ].join('\n'),
    );
  });

  it('underlines every character of the span', () => {
    const expression = 'name.given1';
    const error = new FhirPathSemanticError('semantic/unknown-element', 'Unknown element', {
      expression,
      span: spanFromOffsets(expression, 5, 11),
    });

    expect(error.format().split('\n').slice(1)).toEqual(['  name.given1', '       ^^^^^^']);
  });

  it('shows the line of the span in a multi-line expression', () => {
    const expression = 'name\r\n  .where(use = 1 +)';
    const offset = expression.indexOf(')');
    const error = new FhirPathSyntaxError('syntax/unexpected-token', 'Expected an operand', {
      expression,
      span: spanFromOffsets(expression, offset),
    });

    expect(error.format().split('\n').slice(1)).toEqual([
      '    .where(use = 1 +)',
      '                    ^',
    ]);
  });

  it('keeps tabs so the caret lines up', () => {
    const expression = '\tname.x';
    const error = new FhirPathSyntaxError('syntax/unexpected-character', 'Unexpected', {
      expression,
      span: spanFromOffsets(expression, 6, 7),
    });

    expect(error.format().split('\n')[2]).toBe('  \t     ^');
  });

  it('clamps a span that runs past the end of its line', () => {
    const expression = 'name';
    const error = new FhirPathSyntaxError('syntax/unterminated-string', 'Unterminated', {
      expression,
      span: spanFromOffsets(expression, 2, 40),
    });

    expect(error.format().split('\n')[2]).toBe('    ^^');
  });

  it('prints only the header without a span or expression', () => {
    const error = new FhirPathEvaluationError('eval/singleton-expected', 'Expected one item');

    expect(error.format()).toBe(
      'FhirPathEvaluationError [eval/singleton-expected]: Expected one item',
    );
  });
});

describe('FhirPathError subclasses', () => {
  it.each([
    [new FhirPathSyntaxError('syntax/invalid-escape', 'x'), 'FhirPathSyntaxError'],
    [new FhirPathSemanticError('semantic/wrong-arity', 'x'), 'FhirPathSemanticError'],
    [new FhirPathEvaluationError('eval/aborted', 'x'), 'FhirPathEvaluationError'],
  ])('%s is a FhirPathError and an Error', (error, name) => {
    expect(error).toBeInstanceOf(FhirPathError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
  });

  it('keeps the code, span, expression and cause', () => {
    const cause = new Error('hook failed');
    const span = spanFromOffsets('resolve()', 0, 7);
    const error = new FhirPathEvaluationError('eval/aborted', 'Aborted', {
      span,
      expression: 'resolve()',
      cause,
    });

    expect(error.code).toBe('eval/aborted');
    expect(error.span).toEqual(span);
    expect(error.expression).toBe('resolve()');
    expect(error.cause).toBe(cause);
  });

  it('gives a semantic error one diagnostic by default', () => {
    const span = spanFromOffsets('foo()', 0, 3);
    const error = new FhirPathSemanticError('semantic/unknown-function', 'Unknown function foo', {
      span,
    });

    expect(error.diagnostics).toEqual([
      {
        severity: 'error',
        code: 'semantic/unknown-function',
        message: 'Unknown function foo',
        span,
      },
    ]);
  });

  it('keeps the diagnostics passed to a semantic error', () => {
    const diagnostics = [
      { severity: 'error', code: 'semantic/unknown-type', message: 'Unknown type Foo' },
      { severity: 'warning', code: 'semantic/unknown-element', message: 'Unknown element bar' },
    ] as const;
    const error = new FhirPathSemanticError('semantic/unknown-type', 'Unknown type Foo', {
      diagnostics,
    });

    expect(error.diagnostics).toBe(diagnostics);
  });
});
