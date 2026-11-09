/**
 * The depth limit of compiled expressions.
 *
 * The compiler and the closures it builds recurse once per level of the tree, so a tree thousands
 * of levels deep would exhaust the JavaScript stack with a `RangeError`. The parser never builds a
 * tree deeper than its nesting limit, chains such as `a.b.c…` and `true and true and …` included,
 * but the compiler also takes trees built by hand. It therefore checks the depth first, without
 * recursion, and raises the parser's stable error instead ([architecture: security and robustness](https://github.com/losol/callis/blob/main/docs/architecture.md#security-and-robustness)).
 */
import { assertNever } from '../errors/assert-never.ts';
import { FhirPathSyntaxError } from '../errors/fhirpath-error.ts';
import { LineTable } from '../lexer/line-table.ts';
import type { ExpressionNode } from '../parser/ast.ts';

/** The deepest expression tree the compiler accepts: the parser's default nesting limit. */
export const MAX_COMPILE_DEPTH = 1_000;

/** The direct sub-expressions of a node, in source order. */
export function childNodes(node: ExpressionNode): readonly ExpressionNode[] {
  switch (node.kind) {
    case 'Literal':
    case 'Identifier':
    case 'Variable':
      return [];
    case 'Member':
      return [node.target];
    case 'FunctionCall':
      return node.target === null ? node.args : [node.target, ...node.args];
    case 'Indexer':
      return [node.target, node.index];
    case 'Unary':
      return [node.operand];
    case 'Binary':
      return [node.left, node.right];
    case 'TypeOperation':
      return [node.operand];
    case 'This':
    case 'Index':
    case 'Total':
      return node.target === null ? [] : [node.target];
    default:
      return assertNever(node, 'expression node');
  }
}

/**
 * Raises `syntax/nesting-limit` when the tree is deeper than {@link MAX_COMPILE_DEPTH}. Walks the
 * tree with an explicit stack, so the check itself cannot overflow.
 *
 * @throws {@link FhirPathSyntaxError} `syntax/nesting-limit`, with the span of the first node
 *   that is too deep.
 */
export function checkNesting(root: ExpressionNode, expression: string): void {
  const pending: [ExpressionNode, number][] = [[root, 1]];
  for (let entry = pending.pop(); entry !== undefined; entry = pending.pop()) {
    const [node, depth] = entry;
    if (depth > MAX_COMPILE_DEPTH) {
      throw new FhirPathSyntaxError(
        'syntax/nesting-limit',
        `Expected nesting depth at most ${MAX_COMPILE_DEPTH}`,
        { expression, span: new LineTable(expression).span(node.span.start, node.span.end) },
      );
    }
    for (const child of childNodes(node)) {
      pending.push([child, depth + 1]);
    }
  }
}
