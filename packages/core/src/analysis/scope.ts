/**
 * The scope of an expression node during analysis: the focus, which `$this`, a leading
 * identifier and a function called without a target refer to, and the type guards in force
 * ([T0024: design notes](https://github.com/losol/callis/blob/main/docs/tasks/T0024-static-analysis.md#design-notes)).
 *
 * A type guard is a type test used by a logical operator or `iif()` to decide whether the other
 * operand matters: in `A implies B`, `A and B` and `iif(A, B, …)` the operand `B` is analyzed as
 * if `A` were true, and in `A or B` and `iif(A, …, B)` as if `A` were false. `A` is `X is T`,
 * `X.is(T)`, `(X is T).not()` or a combination of those with `and` and `or`. A guard narrows the
 * types of the expression `X`, named by its path (`$this`, `$this.start`, `%resource.status`),
 * and when nothing remains, `B` is unreachable and raises nothing. The HL7 test suite defines
 * this in its `isSemanticChecks` group ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#type-guards)).
 */
import type { ModelProvider } from '../model/model-provider.ts';
import type { ExpressionNode } from '../parser/ast.ts';
import { isSameType } from '../types/type-test.ts';
import {
  type AnalysisType,
  excludeTypes,
  type Inferred,
  narrowTo,
  type TypeSet,
} from './inferred-type.ts';

/** What a guard says about the expression at `key`: that it is one of `include`, or none of `exclude`. */
export interface Constraint {
  readonly key: string;
  readonly include?: readonly AnalysisType[];
  readonly exclude?: readonly AnalysisType[];
}

/** What is known when a Boolean expression is true, and when it is false. */
export interface Guard {
  readonly whenTrue: readonly Constraint[];
  readonly whenFalse: readonly Constraint[];
}

/** A guard that says nothing. */
export const NO_GUARD: Guard = Object.freeze({ whenTrue: [], whenFalse: [] });

/** The guard that is true when `guard` is false, for `not()`. */
export function negateGuard(guard: Guard): Guard {
  return { whenTrue: guard.whenFalse, whenFalse: guard.whenTrue };
}

/**
 * The most constraints a guard keeps for one path. Combining guards can multiply them (`and`
 * keeps every constraint of both sides, `or` one per pair), so a long chain of clauses would
 * otherwise build an exponential number. Beyond the limit a guard is weakened: it keeps more
 * types, which never rejects an expression, and may miss an error.
 */
export const MAX_CONSTRAINTS_PER_KEY = 8;

/** Both guards hold: everything either says, coalesced per path. */
export function bothGuards(a: readonly Constraint[], b: readonly Constraint[]): Constraint[] {
  return coalesce([...a, ...b]);
}

/**
 * One of two guards holds: only what both say about the same expression, as the union of their
 * `include` sets (`X is T1 or X is T2` means `X` is a `T1` or a `T2`), one constraint per pair
 * of them. What only one says, and exclusions, give no information. When the pairs of a path
 * would exceed {@link MAX_CONSTRAINTS_PER_KEY}, the path gets one constraint with the union of
 * every `include` instead, which is weaker.
 */
export function eitherGuard(a: readonly Constraint[], b: readonly Constraint[]): Constraint[] {
  const result: Constraint[] = [];
  for (const key of new Set(a.map((constraint) => constraint.key))) {
    const left = a.filter(
      (constraint) => constraint.key === key && constraint.include !== undefined,
    );
    const right = b.filter(
      (constraint) => constraint.key === key && constraint.include !== undefined,
    );
    if (left.length === 0 || right.length === 0) {
      continue;
    }
    const includes = (constraints: readonly Constraint[]): AnalysisType[] =>
      distinctTypes(constraints.flatMap((constraint) => constraint.include ?? []));
    if (left.length * right.length > MAX_CONSTRAINTS_PER_KEY) {
      result.push({ key, include: includes([...left, ...right]) });
      continue;
    }
    for (const one of left) {
      for (const other of right) {
        result.push({ key, include: includes([one, other]) });
      }
    }
  }
  return coalesce(result);
}

/**
 * The constraints without repeats, at most {@link MAX_CONSTRAINTS_PER_KEY} per path; the ones
 * beyond the limit are dropped, which keeps more types.
 */
export function coalesce(constraints: readonly Constraint[]): Constraint[] {
  const result: Constraint[] = [];
  const counts = new Map<string, number>();
  for (const constraint of constraints) {
    const count = counts.get(constraint.key) ?? 0;
    if (
      count >= MAX_CONSTRAINTS_PER_KEY ||
      result.some((kept) => sameConstraint(kept, constraint))
    ) {
      continue;
    }
    counts.set(constraint.key, count + 1);
    result.push(constraint);
  }
  return result;
}

function distinctTypes(types: readonly AnalysisType[]): AnalysisType[] {
  const result: AnalysisType[] = [];
  for (const type of types) {
    if (!result.some((kept) => isSameType(kept, type))) {
      result.push(type);
    }
  }
  return result;
}

function sameConstraint(a: Constraint, b: Constraint): boolean {
  return a.key === b.key && sameTypes(a.include, b.include) && sameTypes(a.exclude, b.exclude);
}

function sameTypes(
  a: readonly AnalysisType[] | undefined,
  b: readonly AnalysisType[] | undefined,
): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return (
    a.every((type) => b.some((other) => isSameType(type, other))) &&
    b.every((type) => a.some((other) => isSameType(type, other)))
  );
}

/**
 * The path of a navigation expression, which names it across the expression so that a guard on
 * `$this.start` applies wherever `$this.start` is written: `$this`, a variable, or members of
 * them. An identifier at the start of a path is relative to the focus, so it is `$this.name`.
 * Each name is written as a JSON string, so the one delimited identifier `` `a.b` `` and the
 * path `a.b` get different keys, as do a variable named `v.x` and the path `%v.x`. Undefined for
 * any other expression, which a guard cannot narrow.
 */
export function pathKey(node: ExpressionNode): string | undefined {
  switch (node.kind) {
    case 'This':
      return node.target === null ? '$this' : undefined;
    case 'Variable':
      return `%${JSON.stringify(node.name)}`;
    case 'Identifier':
      return `$this.${JSON.stringify(node.name)}`;
    case 'Member': {
      const target = pathKey(node.target);
      return target === undefined ? undefined : `${target}.${JSON.stringify(node.name)}`;
    }
    default:
      return undefined;
  }
}

/** The scope of a node. */
export interface Scope {
  /** What `$this`, a leading identifier and a function without a target refer to. */
  readonly focus: Inferred;
  /** The guards in force, by the path they constrain. */
  readonly constraints: ReadonlyMap<string, readonly Constraint[]>;
}

/** The scope of the whole expression: the input is the focus. */
export function rootScope(input: Inferred): Scope {
  return { focus: input, constraints: new Map() };
}

/** The scope with more guards in force. */
export function withConstraints(scope: Scope, constraints: readonly Constraint[]): Scope {
  if (constraints.length === 0) {
    return scope;
  }
  const map = new Map(scope.constraints);
  for (const constraint of constraints) {
    map.set(constraint.key, [...(map.get(constraint.key) ?? []), constraint]);
  }
  return { focus: scope.focus, constraints: map };
}

/**
 * The scope of a lambda argument. Its focus is a new value, so the guards on `$this` and on paths
 * from it no longer apply, unless `keepFocus` says that the focus is the same value as outside
 * (`iif()` called without a target). Guards on variables always carry over.
 */
export function lambdaScope(scope: Scope, focus: Inferred, keepFocus: boolean): Scope {
  const map = new Map<string, readonly Constraint[]>();
  for (const [key, constraints] of scope.constraints) {
    if (keepFocus || key.startsWith('%')) {
      map.set(key, constraints);
    }
  }
  return { focus, constraints: map };
}

/** The types of the expression at `key` after the guards in force, or the types unchanged. */
export function narrowByKey(
  scope: Scope,
  key: string,
  inferred: Inferred,
  model: ModelProvider | undefined,
): Inferred {
  const constraints = scope.constraints.get(key);
  if (constraints === undefined) {
    return inferred;
  }
  let types: TypeSet = inferred.types;
  for (const constraint of constraints) {
    if (constraint.include !== undefined) {
      types = narrowTo(types, constraint.include, model, 'is');
    }
    if (constraint.exclude !== undefined) {
      types = excludeTypes(types, constraint.exclude, model);
    }
  }
  return types === inferred.types ? inferred : { ...inferred, types };
}
