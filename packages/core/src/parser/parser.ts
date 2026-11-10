import { FhirPathSyntaxError } from '../errors/fhirpath-error.ts';
import { tokenize } from '../lexer/lexer.ts';
import { LineTable } from '../lexer/line-table.ts';
import type { Token, TokenKind } from '../lexer/token.ts';
import type { ExpressionNode, LiteralNode, TypeSpecifierNode } from './ast.ts';
import { INFIX_BINDING_POWER, isInfixOperator, POSTFIX_BINDING_POWER } from './precedence.ts';

/** Options for syntax parsing, independent of evaluation limits. */
export interface ParseOptions {
  /**
   * Maximum nesting depth (default and maximum 1,000): the levels of the expression tree from the
   * root, which is level 1, down to its deepest node. A parenthesized group counts as a level, and
   * each step of a chain such as `a.b.c`, `a[0][0]` or `a and b and c` nests the steps before it
   * one level deeper.
   */
  readonly maxDepth?: number;
}

/** A parsed expression and its height: the levels from its node down to its deepest node. */
interface Parsed {
  readonly node: ExpressionNode;
  readonly height: number;
}

/** A node without sub-expressions. */
function leaf(node: ExpressionNode): Parsed {
  return { node, height: 1 };
}

/**
 * Parses one complete expression without resolving names or constructing literal values.
 * Grouping widens the enclosed node's span to include both parentheses. The tree is never deeper
 * than `maxDepth`, so code that walks it recursively cannot exhaust the call stack.
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
    const { node } = this.#expression(0, 1);
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

  /** Raises `syntax/nesting-limit` at the next token when a node would be deeper than the limit. */
  #limit(depth: number): void {
    if (depth <= this.#maxDepth) return;
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

  /**
   * Parses an expression whose node is at `depth`, the root being 1, and keeps every node of its
   * tree within the limit. Operands, arguments, indexes and groups are parsed one level deeper.
   * Each step of a chain built in this loop moves the chain so far one level down, so the chain's
   * height is checked before the step is taken.
   */
  #expression(minimum: number, depth: number): Parsed {
    this.#limit(depth);
    let { node: left, height } = this.#prefix(depth);
    for (;;) {
      const token = this.#peek();
      if (token.kind === '.' && POSTFIX_BINDING_POWER.member >= minimum) {
        this.#limit(depth + height);
        this.#take();
        const special = this.#peek();
        if (special.kind === '$this' || special.kind === '$index' || special.kind === '$total') {
          this.#take();
          left = {
            kind: special.kind === '$this' ? 'This' : special.kind === '$index' ? 'Index' : 'Total',
            target: left,
            span: { start: left.span.start, end: special.end },
          };
          height++;
          continue;
        }
        const name = this.#identifier();
        if (this.#peek().kind === '(') {
          ({ node: left, height } = this.#call(name, { node: left, height }, depth));
        } else {
          left = {
            kind: 'Member',
            target: left,
            name: name.value,
            delimited: name.kind === 'DelimitedIdentifier',
            span: { start: left.span.start, end: name.end },
          };
          height++;
        }
      } else if (token.kind === '[' && POSTFIX_BINDING_POWER.indexer >= minimum) {
        this.#limit(depth + height);
        this.#take();
        const index = this.#expression(0, depth + 1);
        const close = this.#expect(']');
        left = {
          kind: 'Indexer',
          target: left,
          index: index.node,
          span: { start: left.span.start, end: close.end },
        };
        height = Math.max(height, index.height) + 1;
      } else {
        const op = token.kind === 'Identifier' ? token.value : token.kind;
        if (
          token.kind === 'DelimitedIdentifier' ||
          !isInfixOperator(op) ||
          INFIX_BINDING_POWER[op] < minimum
        )
          break;
        this.#limit(depth + height);
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
          height++;
        } else {
          const right = this.#expression(INFIX_BINDING_POWER[op] + 1, depth + 1);
          left = {
            kind: 'Binary',
            op,
            left,
            right: right.node,
            span: { start: left.span.start, end: right.node.span.end },
          };
          height = Math.max(height, right.height) + 1;
        }
      }
    }
    return { node: left, height };
  }

  #prefix(depth: number): Parsed {
    const token = this.#peek();
    const span = { start: token.start, end: token.end };
    switch (token.kind) {
      case '+':
      case '-': {
        this.#take();
        const operand = this.#expression(POSTFIX_BINDING_POWER.unary, depth + 1);
        return {
          node: {
            kind: 'Unary',
            op: token.kind,
            operand: operand.node,
            span: { start: token.start, end: operand.node.span.end },
          },
          height: operand.height + 1,
        };
      }
      case '(': {
        this.#take();
        const enclosed = this.#expression(0, depth + 1);
        const close = this.#expect(')');
        // The group counts as a level, as when it was parsed, though the tree has no node for it.
        return {
          node: { ...enclosed.node, span: { start: token.start, end: close.end } },
          height: enclosed.height + 1,
        };
      }
      case '{': {
        this.#take();
        const close = this.#expect('}');
        return leaf({
          kind: 'Literal',
          type: 'Empty',
          raw: this.#source.slice(token.start, close.end),
          span: { start: token.start, end: close.end },
        });
      }
      case 'Number':
        return leaf(this.#number());
      case 'String':
      case 'Date':
      case 'DateTime':
      case 'Time':
        this.#take();
        return leaf({
          kind: 'Literal',
          type: token.kind,
          raw: this.#source.slice(token.start, token.end),
          ...(token.kind === 'String' ? { value: token.value } : {}),
          span,
        });
      case 'EnvironmentVariable': {
        // Quoted variable names can use reserved words; unquoted names follow identifier rules.
        const first = this.#source.charAt(token.start + 1);
        if (first !== "'" && first !== '"' && first !== '`' && reserved.has(token.value))
          this.#error('an identifier after %');
        this.#take();
        return leaf({ kind: 'Variable', name: token.value, span });
      }
      case '$this':
      case '$index':
      case '$total':
        this.#take();
        return leaf({
          kind: token.kind === '$this' ? 'This' : token.kind === '$index' ? 'Index' : 'Total',
          target: null,
          span,
        });
      case 'Identifier':
      case 'DelimitedIdentifier': {
        if (token.kind === 'Identifier' && (token.value === 'true' || token.value === 'false')) {
          this.#take();
          return leaf({ kind: 'Literal', type: 'Boolean', raw: token.value, span });
        }
        const name = this.#identifier();
        return this.#peek().kind === '('
          ? this.#call(name, null, depth)
          : leaf({
              kind: 'Identifier',
              name: name.value,
              delimited: name.kind === 'DelimitedIdentifier',
              span,
            });
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

  #call(name: Token, target: Parsed | null, depth: number): Parsed {
    this.#expect('(');
    const args: ExpressionNode[] = [];
    let height = target?.height ?? 0;
    if (this.#peek().kind !== ')') {
      for (;;) {
        const arg = this.#expression(0, depth + 1);
        args.push(arg.node);
        height = Math.max(height, arg.height);
        if (this.#peek().kind !== ',') break;
        this.#take();
      }
    }
    const close = this.#expect(')');
    return {
      node: {
        kind: 'FunctionCall',
        target: target?.node ?? null,
        name: name.value,
        delimited: name.kind === 'DelimitedIdentifier',
        args,
        span: { start: target?.node.span.start ?? name.start, end: close.end },
      },
      height: height + 1,
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
