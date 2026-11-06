import { describe, expect, it } from 'vitest';
import { compile } from '../api/compile.ts';
import { FhirPathSyntaxError } from '../errors/fhirpath-error.ts';
import { parse } from '../parser/parser.ts';
import { checkNesting, childNodes, MAX_COMPILE_DEPTH } from './nesting.ts';

function caught(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('childNodes', () => {
  it.each<[string, string[]]>([
    ['a', []],
    ['%v', []],
    ['1', []],
    ['a.b', ['Identifier']],
    ['a.f(1, 2)', ['Identifier', 'Literal', 'Literal']],
    ['f(1)', ['Literal']],
    ['a[1]', ['Identifier', 'Literal']],
    ['-a', ['Identifier']],
    ['a and b', ['Identifier', 'Identifier']],
    ['a is String', ['Identifier']],
    ['$this', []],
    ['a.$index', ['Identifier']],
  ])('gives the sub-expressions of %s', (expression, kinds) => {
    expect(childNodes(parse(expression)).map((node) => node.kind)).toEqual(kinds);
  });
});

// The parser builds chains in a loop, so they can be deeper than its nesting limit.
describe('the compile depth limit', () => {
  const chains: [string, (length: number) => string][] = [
    ['member chain', (length) => `a${'.a'.repeat(length)}`],
    ['function call chain', (length) => `true${'.not()'.repeat(length)}`],
    ['indexer chain', (length) => `a${'[0]'.repeat(length)}`],
    ['left-associative operators', (length) => `true${' and true'.repeat(length)}`],
    ['type operations', (length) => `true${' is Boolean'.repeat(length)}`],
  ];

  it.each(chains)('compiles and evaluates a %s at the limit', (_label, make) => {
    const compiled = compile(make(MAX_COMPILE_DEPTH - 1));
    expect(() => compiled.evaluate({ a: [{ a: 1 }] })).not.toThrow(RangeError);
  });

  it.each(chains)(
    'raises syntax/nesting-limit, not a RangeError, for a much longer %s',
    (_label, make) => {
      const error = caught(() => compile(make(50_000)));
      expect(error).toBeInstanceOf(FhirPathSyntaxError);
      expect(error).toMatchObject({ code: 'syntax/nesting-limit' });
    },
  );

  it('reports the node that is too deep', () => {
    const expression = `a${'.a'.repeat(MAX_COMPILE_DEPTH)}`;
    const error = caught(() => checkNesting(parse(expression), expression));
    expect(error).toMatchObject({ code: 'syntax/nesting-limit', expression });
    // The innermost member chain node of depth 1001 is the root identifier `a`.
    expect((error as FhirPathSyntaxError).span).toMatchObject({ start: 0, end: 1 });
  });
});
