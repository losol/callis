/** Binary operators built on the shared value kernels. @see https://hl7.org/fhirpath/N1/#operations */
import { arithmetic } from './arithmetic.ts';
import { type Collection, EMPTY, fromBoolean, type Item } from './collection.ts';
import type { ComparisonContext } from './comparison.ts';
import { compare } from './comparison.ts';
import { equals, equivalent, itemEquals } from './equality.ts';
import { singleton } from './singleton.ts';

/** An operator's evaluated operands and the context needed by the value kernels. */
export type BinaryOperation = (
  left: Collection,
  right: Collection,
  ctx: ComparisonContext,
) => Collection;

/**
 * The compiler selects the operation once; evaluations only dispatch over operand value types.
 * Boolean logic is compiled separately because it converts each operand to Boolean.
 * @see https://hl7.org/fhirpath/N1/#operations
 */
export const BINARY_OPERATIONS: Readonly<
  Record<
    | '='
    | '!='
    | '~'
    | '!~'
    | '<'
    | '>'
    | '<='
    | '>='
    | '+'
    | '-'
    | '*'
    | '/'
    | 'div'
    | 'mod'
    | '&'
    | '|'
    | 'in'
    | 'contains',
    BinaryOperation
  >
> = Object.freeze({
  '=': (a, b, ctx) => fromBoolean(equals(a, b, ctx)),
  '!=': (a, b, ctx) => fromBoolean(negate(equals(a, b, ctx))),
  '~': (a, b, ctx) => fromBoolean(equivalent(a, b, ctx)),
  '!~': (a, b, ctx) => fromBoolean(!equivalent(a, b, ctx)),
  '<': (a, b, ctx) => order(a, b, ctx, (value) => value < 0),
  '>': (a, b, ctx) => order(a, b, ctx, (value) => value > 0),
  '<=': (a, b, ctx) => order(a, b, ctx, (value) => value <= 0),
  '>=': (a, b, ctx) => order(a, b, ctx, (value) => value >= 0),
  '+': (a, b, ctx) => arithmetic('+', a, b, ctx.units),
  '-': (a, b, ctx) => arithmetic('-', a, b, ctx.units),
  '*': (a, b, ctx) => arithmetic('*', a, b, ctx.units),
  '/': (a, b, ctx) => arithmetic('/', a, b, ctx.units),
  div: (a, b, ctx) => arithmetic('div', a, b, ctx.units),
  mod: (a, b, ctx) => arithmetic('mod', a, b, ctx.units),
  '&': (a, b, ctx) => arithmetic('&', a, b, ctx.units),
  '|': union,
  in: membership,
  contains: (a, b, ctx) => membership(b, a, ctx),
});

function identity(item: Item): Item {
  return item;
}

function negate(value: boolean | undefined): boolean | undefined {
  return value === undefined ? undefined : !value;
}

function order(
  left: Collection,
  right: Collection,
  ctx: ComparisonContext,
  accepts: (value: number) => boolean,
): Collection {
  // Keep nodes intact: comparison owns model-less input date conversion and provenance.
  const a = singleton(left, 'Any', identity);
  const b = singleton(right, 'Any', identity);
  if (a === undefined || b === undefined) return EMPTY;
  const value = compare(a, b, ctx);
  return fromBoolean(value === undefined ? undefined : accepts(value));
}

function membership(left: Collection, right: Collection, ctx: ComparisonContext): Collection {
  const item = singleton(left, 'Any', identity);
  if (item === undefined) return EMPTY;
  return fromBoolean(right.some((candidate) => itemEquals(item, candidate, ctx) === true));
}

function union(left: Collection, right: Collection, ctx: ComparisonContext): Collection {
  const result: Item[] = [];
  for (const input of [left, right]) {
    for (const item of input) {
      // Unknown equality does not establish a duplicate. Preserve the original input nodes.
      if (!result.some((candidate) => itemEquals(candidate, item, ctx) === true)) result.push(item);
    }
  }
  return result;
}
