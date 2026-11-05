import type { ExpressionNode } from './ast.ts';

/** Test-only compact structural rendering; deliberately not a package export. */
export function printAst(node: ExpressionNode): string {
  switch (node.kind) {
    case 'Identifier':
      return node.delimited ? `\`${node.name}\`` : node.name;
    case 'Literal':
      return node.type === 'Quantity'
        ? `(Quantity ${node.number} ${JSON.stringify(node.unit)})`
        : node.raw;
    case 'Member':
      return `(. ${printAst(node.target)} ${node.delimited ? `\`${node.name}\`` : node.name})`;
    case 'FunctionCall':
      return `(call ${node.target === null ? '_' : printAst(node.target)} ${node.name}${node.args.map((arg) => ` ${printAst(arg)}`).join('')})`;
    case 'Indexer':
      return `([] ${printAst(node.target)} ${printAst(node.index)})`;
    case 'Unary':
      return `(${node.op} ${printAst(node.operand)})`;
    case 'Binary':
      return `(${node.op} ${printAst(node.left)} ${printAst(node.right)})`;
    case 'TypeOperation':
      return `(${node.op} ${printAst(node.operand)} ${node.type.identifiers.join('.')})`;
    case 'Variable':
      return `(% ${JSON.stringify(node.name)})`;
    case 'This':
    case 'Index':
    case 'Total':
      return node.target === undefined
        ? `$${node.kind.toLowerCase()}`
        : `(. ${printAst(node.target)} $${node.kind.toLowerCase()})`;
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}
