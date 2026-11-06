/**
 * Targets of `is`, `as` and `ofType()`: a type specifier resolved once at compile time, and how an
 * item is matched against it at runtime.
 *
 * - [T0008: type names that do not resolve](https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md#type-names-that-do-not-resolve)
 * - [T0008: resource type names without a model](https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md#resource-type-names-without-a-model)
 * - [spec notes: unresolved type specifiers are execution errors](https://github.com/losol/callis/blob/main/docs/spec-notes.md#unresolved-type-specifiers-are-execution-errors)
 */
import { assertNever } from '../errors/assert-never.ts';
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { ModelNode } from '../model/model-node.ts';
import type { ModelProvider, ModelTypeInfo } from '../model/model-provider.ts';
import { isSystemType, SYSTEM_TYPES, type SystemType } from '../types/system-types.ts';
import { resolveTypeSpecifier, type TypeSpecifier } from '../types/type-specifier.ts';
import { isOfType, matchesOfType } from '../types/type-test.ts';
import { type Collection, EMPTY, type Item } from './collection.ts';
import type { EvalContext } from './context.ts';
import { hasResourceType } from './navigation.ts';
import { toSystemValue } from './node-value.ts';
import { kindOf } from './operands.ts';
import { singleton } from './singleton.ts';

/**
 * A type specifier after compile-time resolution.
 *
 * - `type`: a System type, or a type of the model.
 * - `resource`: without a model, an unqualified name that is not a System type. It matches input
 *   objects whose own `resourceType` is exactly that name.
 * - `unresolved`: a name that resolves to nothing. Using it raises `eval/unknown-type`.
 */
export type TypeTarget =
  | { readonly kind: 'type'; readonly type: SystemType | ModelTypeInfo }
  | { readonly kind: 'resource'; readonly name: string }
  | { readonly kind: 'unresolved'; readonly specifier: TypeSpecifier };

/**
 * Resolves a type specifier once, at compile time. Never throws: an unknown name becomes an
 * `unresolved` target, which raises only when the operator or function using it is evaluated,
 * so that a branch that is never evaluated does not fail.
 *
 * - A name that resolves with `resolveTypeSpecifier()` is a `type` target: the model namespace
 *   first, then System; qualified names only in their own namespace.
 * - Without a model, any other unqualified name is a `resource` target, even one that is
 *   misspelled. A qualified name never is: `FHIR.Patient` without a model is unresolved.
 * - With a model, an unknown name is unresolved.
 */
export function resolveTypeTarget(
  specifier: TypeSpecifier,
  model: ModelProvider | undefined,
): TypeTarget {
  const type = resolveTypeSpecifier(specifier, model);
  if (type !== undefined) {
    return { kind: 'type', type };
  }
  if (model === undefined && specifier.namespace === undefined) {
    return { kind: 'resource', name: specifier.name };
  }
  return { kind: 'unresolved', specifier };
}

/** A type specifier as written, such as `System.Patient`. */
function specifierText(specifier: TypeSpecifier): string {
  return specifier.namespace === undefined
    ? specifier.name
    : `${specifier.namespace}.${specifier.name}`;
}

/**
 * Raises `eval/unknown-type` for an unresolved target, and does nothing otherwise. Callers check
 * the target before they look at the input, so an unknown type fails on empty input too.
 *
 * @throws {@link FhirPathEvaluationError} `eval/unknown-type` for an unresolved target.
 */
export function assertResolved(target: TypeTarget): void {
  if (target.kind === 'unresolved') {
    throw new FhirPathEvaluationError(
      'eval/unknown-type',
      `The type ${specifierText(target.specifier)} is not defined`,
    );
  }
}

/**
 * The System type of a System value, or undefined for a node (an object value or one without a
 * value). Numbers in collections are Integers; Decimals are `Decimal` objects. Uses the value
 * kinds of the equality and ordering kernels, so both agree on what a value is.
 */
export function systemTypeOf(value: Item): SystemType | undefined {
  const kind = kindOf(value);
  return kind === 'Complex' ? undefined : SYSTEM_TYPES[kind];
}

/**
 * How a typed model node is tested: `is` (and `as`) do not accept the System type a FHIR
 * primitive converts to, `ofType` does ([spec notes: FHIR primitives](https://github.com/losol/callis/blob/main/docs/spec-notes.md#fhir-primitives-in-is-as-and-oftype)).
 */
export type TypeTestRule = 'is' | 'ofType';

/**
 * Whether one item matches a resolved target.
 *
 * - `System.Any` matches every item ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#every-type-is-a-systemany-including-model-types)).
 * - A `resource` target matches an input node whose JSON object has that own `resourceType`,
 *   case-sensitively. A string `'Patient'` is not a Patient, and nothing is inferred about base
 *   types: a Patient does not match `Resource`.
 * - A node with a model type is tested with the model's inheritance (T0018 creates such nodes).
 * - Any other item is tested by the System type of its value. Untyped object nodes have none.
 *
 * @throws {@link FhirPathEvaluationError} `eval/unknown-type` for an unresolved target.
 */
export function matchesTypeTarget(
  item: Item,
  target: TypeTarget,
  ctx: EvalContext,
  rule: TypeTestRule = 'is',
): boolean {
  switch (target.kind) {
    case 'unresolved':
      assertResolved(target);
      return false;
    case 'resource':
      return hasResourceType(item, target.name);
    case 'type':
      return matchesType(item, target.type, ctx.model, rule);
    default:
      return assertNever(target, 'type target');
  }
}

function matchesType(
  item: Item,
  type: SystemType | ModelTypeInfo,
  model: ModelProvider | undefined,
  rule: TypeTestRule,
): boolean {
  if (isSystemType(type) && type.name === 'Any') {
    return true;
  }
  if (item instanceof ModelNode && item.type !== undefined) {
    return rule === 'is' ? isOfType(item.type, type, model) : matchesOfType(item.type, type, model);
  }
  const value = toSystemValue(item);
  const valueType = value === undefined ? undefined : systemTypeOf(value);
  return valueType !== undefined && isOfType(valueType, type);
}

/**
 * The `is` operator and function on a collection
 * ([N1 §6.3.1](https://hl7.org/fhirpath/N1/#is-type-specifier), [3.0.0](https://hl7.org/fhirpath/STU3/en/#is-type-specifier)):
 * an unresolved target raises `eval/unknown-type`, also on empty input; empty input is false; more
 * than one item raises `eval/singleton-expected`.
 */
export function isType(input: Collection, target: TypeTarget, ctx: EvalContext): boolean {
  assertResolved(target);
  const item = singleton(input, 'Any', identity);
  return item !== undefined && matchesTypeTarget(item, target, ctx);
}

/**
 * The `as` operator and function on a collection
 * ([N1 §6.3.3](https://hl7.org/fhirpath/N1/#as-type-specifier), [3.0.0](https://hl7.org/fhirpath/STU3/en/#as-type-specifier)):
 * the item itself when it matches, otherwise empty. The target and the input are checked as for
 * {@link isType}.
 */
export function asType(input: Collection, target: TypeTarget, ctx: EvalContext): Collection {
  assertResolved(target);
  const item = singleton(input, 'Any', identity);
  return item !== undefined && matchesTypeTarget(item, target, ctx) ? [item] : EMPTY;
}

function identity(item: Item): Item {
  return item;
}
