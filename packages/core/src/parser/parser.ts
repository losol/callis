import { FhirPathSyntaxError } from '../errors/fhirpath-error.ts';
import { tokenize } from '../lexer/lexer.ts';
import { LineTable } from '../lexer/line-table.ts';
import type { Token, TokenKind } from '../lexer/token.ts';
import type { ExpressionNode, FunctionCallNode, LiteralNode, TypeSpecifierNode } from './ast.ts';
import { INFIX_BINDING_POWER, isInfixOperator, POSTFIX_BINDING_POWER } from './precedence.ts';

/** Options for syntax parsing, independent of evaluation limits. */
export interface ParseOptions {
  /** Maximum recursive expression depth, including the root (default and maximum 1,000). */
  readonly maxDepth?: number;
}

/**
 * Parses one complete expression without resolving names or constructing literal values.
 * Grouping widens the enclosed node's span to include both parentheses.
 *
 * @throws {FhirPathSyntaxError} On the first lexical or grammatical error, or the nesting limit.
 * @see https://hl7.org/fhirpath/N1/grammar.html
 * @see https://hl7.org/fhirpath/N1/#operator-precedence
 */
export function parse(expression: string, options: ParseOptions = {}): ExpressionNode {
  return new Parser(expression, options).run();
}

const calendarUnits: ReadonlySet<string> = new Set([
  'year',
  'years',
  'month',
  'months',
  'week',
  'weeks',
  'day',
  'days',
  'hour',
  'hours',
  'minute',
  'minutes',
  'second',
  'seconds',
  'millisecond',
  'milliseconds',
]);
// The grammar permits only these four operator keywords as bare identifiers.
// https://hl7.org/fhirpath/N1/#keywords
const reserved: ReadonlySet<string> = new Set([
  'true',
  'false',
  'div',
  'mod',
  'and',
  'or',
  'xor',
  'implies',
  ...calendarUnits,
]);

class Parser {
  readonly #source: string;
  readonly #tokens: readonly Token[];
  readonly #maxDepth: number;
  #position = 0;

  constructor(source: string, options: ParseOptions) {
    this.#source = source;
    this.#tokens = tokenize(source);
    this.#maxDepth = options.maxDepth ?? 1_000;
    if (!Number.isSafeInteger(this.#maxDepth) || this.#maxDepth < 1 || this.#maxDepth > 1_000) {
      throw new FhirPathSyntaxError(
        'syntax/nesting-limit',
        'Expected maxDepth to be an integer from 1 to 1000',
        { expression: source },
      );
    }
  }

  run(): ExpressionNode {
    const node = this.#expression(0, 1);
    this.#expect('EOF');
    return node;
  }

  #peek(): Token {
    // tokenize always supplies EOF; after EOF no further token is consumed.
    return (
      this.#tokens[this.#position] ?? {
        kind: 'EOF',
        start: this.#source.length,
        end: this.#source.length,
        value: '',
      }
    );
  }

  #take(): Token {
    const token = this.#peek();
    this.#position++;
    return token;
  }

  #expect(kind: TokenKind): Token {
    if (this.#peek().kind !== kind) this.#error(kind === 'EOF' ? 'end of input' : `'${kind}'`);
    return this.#take();
  }

  #error(expected: string): never {
    const token = this.#peek();
    throw new FhirPathSyntaxError(
      'syntax/unexpected-token',
      `Expected ${expected} but found ${token.kind === 'EOF' ? 'end of input' : JSON.stringify(token.value)}`,
      {
        expression: this.#source,
        span: new LineTable(this.#source).span(token.start, token.end),
      },
    );
  }

  #expression(minimum: number, depth: number): ExpressionNode {
    if (depth > this.#maxDepth) {
      const token = this.#peek();
      throw new FhirPathSyntaxError(
        'syntax/nesting-limit',
        `Expected nesting depth at most ${this.#maxDepth}`,
        {
          expression: this.#source,
          span: new LineTable(this.#source).span(token.start, token.end),
        },
      );
    }
    let left = this.#prefix(depth);
    for (;;) {
      const token = this.#peek();
      if (token.kind === '.' && POSTFIX_BINDING_POWER.member >= minimum) {
        this.#take();
        const special = this.#peek();
        if (special.kind === '$this' || special.kind === '$index' || special.kind === '$total') {
          this.#take();
          left = {
            kind: special.kind === '$this' ? 'This' : special.kind === '$index' ? 'Index' : 'Total',
            target: left,
            span: { start: left.span.start, end: special.end },
          };
          continue;
        }
        const name = this.#identifier();
        left =
          this.#peek().kind === '('
            ? this.#call(name, left, depth)
            : {
                kind: 'Member',
                target: left,
                name: name.value,
                delimited: name.kind === 'DelimitedIdentifier',
                span: { start: left.span.start, end: name.end },
              };
      } else if (token.kind === '[' && POSTFIX_BINDING_POWER.indexer >= minimum) {
        this.#take();
        const index = this.#expression(0, depth + 1);
        const close = this.#expect(']');
        left = {
          kind: 'Indexer',
          target: left,
          index,
          span: { start: left.span.start, end: close.end },
        };
      } else {
        const op = token.kind === 'Identifier' ? token.value : token.kind;
        if (
          token.kind === 'DelimitedIdentifier' ||
          !isInfixOperator(op) ||
          INFIX_BINDING_POWER[op] < minimum
        )
          break;
        this.#take();
        if (op === 'is' || op === 'as') {
          const type = this.#typeSpecifier();
          left = {
            kind: 'TypeOperation',
            op,
            operand: left,
            type,
            span: { start: left.span.start, end: type.span.end },
          };
        } else {
          const right = this.#expression(INFIX_BINDING_POWER[op] + 1, depth + 1);
          left = {
            kind: 'Binary',
            op,
            left,
            right,
            span: { start: left.span.start, end: right.span.end },
          };
        }
      }
    }
    return left;
  }

  #prefix(depth: number): ExpressionNode {
    const token = this.#peek();
    const span = { start: token.start, end: token.end };
    switch (token.kind) {
      case '+':
      case '-': {
        this.#take();
        const operand = this.#expression(POSTFIX_BINDING_POWER.unary, depth + 1);
        return {
          kind: 'Unary',
          op: token.kind,
          operand,
          span: { start: token.start, end: operand.span.end },
        };
      }
      case '(': {
        this.#take();
        const enclosed = this.#expression(0, depth + 1);
        const close = this.#expect(')');
        return { ...enclosed, span: { start: token.start, end: close.end } };
      }
      case '{': {
        this.#take();
        const close = this.#expect('}');
        return {
          kind: 'Literal',
          type: 'Empty',
          raw: this.#source.slice(token.start, close.end),
          span: { start: token.start, end: close.end },
        };
      }
      case 'Number':
        return this.#number();
      case 'String':
      case 'Date':
      case 'DateTime':
      case 'Time':
        this.#take();
        return {
          kind: 'Literal',
          type: token.kind,
          raw: this.#source.slice(token.start, token.end),
          ...(token.kind === 'String' ? { value: token.value } : {}),
          span,
        };
      case 'EnvironmentVariable': {
        // Quoted variable names can use reserved words; unquoted names follow identifier rules.
        const first = this.#source.charAt(token.start + 1);
        if (first !== "'" && first !== '"' && first !== '`' && reserved.has(token.value))
          this.#error('an identifier after %');
        this.#take();
        return { kind: 'Variable', name: token.value, span };
      }
      case '$this':
      case '$index':
      case '$total':
        this.#take();
        return {
          kind: token.kind === '$this' ? 'This' : token.kind === '$index' ? 'Index' : 'Total',
          target: null,
          span,
        };
      case 'Identifier':
      case 'DelimitedIdentifier': {
        if (token.kind === 'Identifier' && (token.value === 'true' || token.value === 'false')) {
          this.#take();
          return { kind: 'Literal', type: 'Boolean', raw: token.value, span };
        }
        const name = this.#identifier();
        return this.#peek().kind === '('
          ? this.#call(name, null, depth)
          : {
              kind: 'Identifier',
              name: name.value,
              delimited: name.kind === 'DelimitedIdentifier',
              span,
            };
      }
      default:
        return this.#error('an expression');
    }
  }

  #identifier(): Token {
    const token = this.#peek();
    if (
      token.kind !== 'DelimitedIdentifier' &&
      (token.kind !== 'Identifier' || reserved.has(token.value))
    )
      this.#error('an identifier');
    return this.#take();
  }

  #number(): LiteralNode {
    const number = this.#take();
    const unit = this.#peek();
    if (unit.kind === 'String' || (unit.kind === 'Identifier' && calendarUnits.has(unit.value))) {
      this.#take();
      return {
        kind: 'Literal',
        type: 'Quantity',
        raw: this.#source.slice(number.start, unit.end),
        number: number.value,
        unit: unit.value,
        span: { start: number.start, end: unit.end },
      };
    }
    return {
      kind: 'Literal',
      type: number.value.includes('.') ? 'Decimal' : 'Integer',
      raw: number.value,
      span: { start: number.start, end: number.end },
    };
  }

  #call(name: Token, target: ExpressionNode | null, depth: number): FunctionCallNode {
    this.#expect('(');
    const args: ExpressionNode[] = [];
    if (this.#peek().kind !== ')') {
      for (;;) {
        args.push(this.#expression(0, depth + 1));
        if (this.#peek().kind !== ',') break;
        this.#take();
      }
    }
    const close = this.#expect(')');
    return {
      kind: 'FunctionCall',
      target,
      name: name.value,
      delimited: name.kind === 'DelimitedIdentifier',
      args,
      span: { start: target?.span.start ?? name.start, end: close.end },
    };
  }

  #typeSpecifier(): TypeSpecifierNode {
    const first = this.#identifier();
    const identifiers = [first.value];
    let end = first.end;
    // Greedy by grammar: x as Quantity.unit names a type, not a member access.
    // https://hl7.org/fhirpath/N1/grammar.html
    while (this.#peek().kind === '.') {
      const nameToken = this.#tokens[this.#position + 1];
      // A function call or frame-variable invocation cannot be part of a type name.
      // Leave its dot to the outer invocation expression, even after a type operation.
      if (
        nameToken?.kind === '$this' ||
        nameToken?.kind === '$index' ||
        nameToken?.kind === '$total' ||
        this.#tokens[this.#position + 2]?.kind === '('
      )
        break;
      this.#take();
      const name = this.#identifier();
      identifiers.push(name.value);
      end = name.end;
    }
    return { kind: 'TypeSpecifier', identifiers, span: { start: first.start, end } };
  }
}
