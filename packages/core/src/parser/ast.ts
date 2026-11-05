/** UTF-16 source offsets, with an exclusive end. */
export interface NodeSpan {
  readonly start: number;
  readonly end: number;
}

/** Source location shared by every AST node. */
export interface AstNode {
  readonly span: NodeSpan;
}

/** Literal syntax; construction and validation belong to the compiler. */
export interface LiteralNode extends AstNode {
  readonly kind: 'Literal';
  readonly type:
    | 'Boolean'
    | 'String'
    | 'Integer'
    | 'Decimal'
    | 'Date'
    | 'DateTime'
    | 'Time'
    | 'Quantity'
    | 'Empty';
  readonly raw: string;
  /** Decoded String text; absent for other literal types. */
  readonly value?: string;
  /** Decoded unit or calendar keyword for a Quantity. */
  readonly unit?: string;
  /** Raw numeric text of a Quantity, without its unit. */
  readonly number?: string;
}

/** An unresolved root member or model type name. */
export interface IdentifierNode extends AstNode {
  readonly kind: 'Identifier';
  readonly name: string;
  readonly delimited: boolean;
}

/** Navigation from an expression to a named member. */
export interface MemberNode extends AstNode {
  readonly kind: 'Member';
  readonly target: ExpressionNode;
  readonly name: string;
  readonly delimited: boolean;
}

/** Invocation; null target means the implicit focus. Arguments remain expressions, including types. */
export interface FunctionCallNode extends AstNode {
  readonly kind: 'FunctionCall';
  readonly target: ExpressionNode | null;
  readonly name: string;
  readonly delimited: boolean;
  readonly args: readonly ExpressionNode[];
}

/** Indexing an expression by another expression. */
export interface IndexerNode extends AstNode {
  readonly kind: 'Indexer';
  readonly target: ExpressionNode;
  readonly index: ExpressionNode;
}

/** Prefix polarity; negative numeric folding belongs to the compiler. */
export interface UnaryNode extends AstNode {
  readonly kind: 'Unary';
  readonly op: '+' | '-';
  readonly operand: ExpressionNode;
}

/** The binary operators in phase 1, excluding type operations. */
export type BinaryOperator =
  | '*'
  | '/'
  | 'div'
  | 'mod'
  | '+'
  | '-'
  | '&'
  | '|'
  | '<'
  | '>'
  | '<='
  | '>='
  | '='
  | '~'
  | '!='
  | '!~'
  | 'in'
  | 'contains'
  | 'and'
  | 'or'
  | 'xor'
  | 'implies';

/** A left-associative binary operation. */
export interface BinaryNode extends AstNode {
  readonly kind: 'Binary';
  readonly op: BinaryOperator;
  readonly left: ExpressionNode;
  readonly right: ExpressionNode;
}

/** A syntactic type name, kept separate from the resolved types/TypeSpecifier. */
export interface TypeSpecifierNode extends AstNode {
  readonly kind: 'TypeSpecifier';
  /** Decoded identifiers in source order, preserving spelling and case. */
  readonly identifiers: readonly string[];
}

/** The infix is/as forms greedily consume a qualified type name. */
export interface TypeOperationNode extends AstNode {
  readonly kind: 'TypeOperation';
  readonly op: 'is' | 'as';
  readonly operand: ExpressionNode;
  readonly type: TypeSpecifierNode;
}

/** An environment variable, with its decoded name. */
export interface VariableNode extends AstNode {
  readonly kind: 'Variable';
  readonly name: string;
}

/** The current iteration item. */
export interface ThisNode extends AstNode {
  readonly kind: 'This';
  readonly target?: ExpressionNode;
}
/** The current iteration index. */
export interface IndexNode extends AstNode {
  readonly kind: 'Index';
  readonly target?: ExpressionNode;
}
/** The aggregate accumulator; its valid context is checked later. */
export interface TotalNode extends AstNode {
  readonly kind: 'Total';
  readonly target?: ExpressionNode;
}

/** Syntax-only expression tree. Grouping widens the enclosed node's span. */
export type ExpressionNode =
  | LiteralNode
  | IdentifierNode
  | MemberNode
  | FunctionCallNode
  | IndexerNode
  | UnaryNode
  | BinaryNode
  | TypeOperationNode
  | VariableNode
  | ThisNode
  | IndexNode
  | TotalNode;
