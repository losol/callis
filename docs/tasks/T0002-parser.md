# T0002 — Parser and AST

Part of the [roadmap](../roadmap.md). Phase 1 · wave 2 · size M.

- **Depends on:** [T0001](T0001-lexer.md)
- **Parallel with:** [T0006](T0006-quantity.md), [T0019](T0019-fhir-model-generator.md)
- **Conformance groups:** `comments`, `testPrecedence` (parse level)
- **Background:** [ADR-0002](../adr/0002-hand-written-parser.md)

## Goal

A Pratt/recursive-descent parser that produces the AST from [design notes](#design-notes).

## Scope

- `src/parser/ast.ts`: node types with spans, where literals keep their raw text.
- `src/parser/precedence.ts` and `parser.ts`:
  - the binding-power table
  - postfix `.` and `[]`
  - prefix `+` and `-`
  - `is`/`as` with greedy type specifiers
  - function calls and argument lists
  - quantity literals (number + string, or number + calendar keyword)
  - `{}`
  - keyword-identifiers (`as`, `contains`, `in`, `is`)
  - a nesting-depth limit
- An internal `parse()` and a test-only AST printer (S-expressions) for compact structural assertions.
- Syntax errors that name the expected token.

## Design notes

### Binding powers

These follow [N1 §6.8](https://hl7.org/fhirpath/N1/#operator-precedence) and the ANTLR grammar. All binary operators are left-associative.

| Binding power | Operators | Kind |
| ---: | --- | --- |
| 13 (highest) | `.` invocation | postfix |
| 12 | `[ ]` indexer | postfix |
| 11 | unary `+`, `-` | prefix |
| 10 | `*`, `/`, `div`, `mod` | infix |
| 9 | `+`, `-`, `&` | infix |
| 8 | `is`, `as` (right side is a type specifier) | infix |
| 7 | `\|` | infix |
| 6 | `<`, `>`, `<=`, `>=` | infix |
| 5 | `=`, `~`, `!=`, `!~` | infix |
| 4 | `in`, `contains` | infix |
| 3 | `and` | infix |
| 2 | `or`, `xor` | infix |
| 1 | `implies` | infix |

Rules worth calling out:

- **Unary minus binds looser than `.`**, so `-1.convertsToInteger()` parses as `-(1.convertsToInteger())`, as in the N1 §6.8 example. The AST stays faithful to this; the compiler folds `-<number literal>` into a negative literal.
- **`is` / `as` read a qualified identifier greedily.** `x as Quantity.unit` names the type `Quantity.unit`, so authors must write `(x as Quantity).unit`. This matches the ANTLR grammar.
- The function forms `is(T)`, `as(T)` and `ofType(T)` parse their argument as an expression. The compiler then reads it as a type specifier: an identifier or a chain of member accesses.
- `NUMBER` followed by a `STRING` or a calendar keyword becomes a `Quantity` literal. `{}` is the empty literal.
- `as`, `contains`, `in` and `is` are accepted where an identifier is expected, as in `'abc'.contains('b')`.
- A leading identifier is parsed as a plain `Identifier`. Whether it names a type (such as `Patient`) or a path is decided later ([T0018: navigation rules](T0018-model-aware-evaluation.md#navigation-rules)).
- **Nesting limit:** a maximum depth (default 1,000) prevents stack overflows on hostile input.
- The parser stops at the **first error**. Error recovery for editor use may come later.

### AST

The AST is a discriminated union. Every node has `span: { start: number; end: number }`.

```ts
type ExpressionNode =
  | LiteralNode          // { kind: 'Literal', type: 'Boolean' | 'String' | 'Integer' | 'Decimal' | 'Date' | 'DateTime' | 'Time' | 'Quantity' | 'Empty', raw: string, unit?: string }
  | IdentifierNode       // { kind: 'Identifier', name, delimited }       — root-level member or type name
  | MemberNode           // { kind: 'Member', target, name, delimited }   — a.b
  | FunctionCallNode     // { kind: 'FunctionCall', target | null, name, args }
  | IndexerNode          // { kind: 'Indexer', target, index }
  | UnaryNode            // { kind: 'Unary', op: '+' | '-', operand }
  | BinaryNode           // { kind: 'Binary', op, left, right }
  | TypeOperationNode    // { kind: 'TypeOperation', op: 'is' | 'as', operand, type: TypeSpecifier }
  | VariableNode         // { kind: 'Variable', name }                    — %name
  | ThisNode | IndexNode | TotalNode;                                   // $this, $index, $total
```

Literal nodes keep the **raw source text**. The compiler converts it with the value modules. This keeps the parser independent of the `Decimal` and date/time implementations, so they can be built in parallel, and it preserves decimal precision (`1.0` vs `1`). Literal values that are well-formed but invalid (`@2015-02-30`, `@T14:34:28Z`) are handled by the compiler at evaluation time; see [T0008: invalid literal values](T0008-compiler-evaluator.md#invalid-literal-values).

The AST is part of the public API (`parse()`), but its shape is not frozen before 1.0.

## Acceptance criteria

- [ ] Each adjacent pair of precedence levels has a test, as does left-associativity and the N1 §6.8 example `-7.combine(3)`. `x as Quantity.unit` parses as a type specifier.
- [ ] Every in-scope `<expression>` in `tests-fhir-r4.xml` and `tests-fhir-r5.xml` without `invalid="syntax"` parses, and every in-scope `invalid="syntax"` one throws `FhirPathSyntaxError`. Exceptions, each listed in the PR:
  - out-of-scope groups (`documentFunctions`, `cdaTests`)
  - expressions that use phase-2 syntax (`L` literals, instance selectors)
  - suite labels that do not describe a grammar error. For example, `testSection13` marks the well-formed call `Bundle.section('http://loinc.org', '11450-4', 1)` as `syntax`, although the problem is the arity of an extension function. These go into `spec-notes.md`. The parser stays purely syntactic and does not check functions.

  The XML files come from T0022's vendored fixtures; if T0022 has not landed yet, copy the two files into the test folder temporarily.

- [ ] No imports from `values/`; literal conversion is the compiler's job (T0008).
- [ ] Line coverage of `parser/` is at least 95%.
