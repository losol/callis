/**
 * The function forms of the type operators, `is(type)` and `as(type)`
 * ([N1 §6.3](https://hl7.org/fhirpath/N1/#types), [3.0.0](https://hl7.org/fhirpath/STU3/en/#types)).
 * They share the target resolution and matching of the operators, including `eval/unknown-type`
 * for a type that does not resolve ([T0008: type names that do not resolve](https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md#type-names-that-do-not-resolve)).
 */
import { fromBoolean } from '../runtime/collection.ts';
import { asType, isType } from '../runtime/type-target.ts';
import { defineFunction, type FunctionDefinition, typeArg } from './define.ts';

/**
 * `is(type)`: whether the single input item is of the type.
 *
 * @see https://hl7.org/fhirpath/N1/#istype-type-specifier
 */
export const isFunction: FunctionDefinition = defineFunction({
  name: 'is',
  params: [{ kind: 'type', name: 'type' }],
  input: { singleton: true },
  returns: { type: 'Boolean', singleton: true },
  impl: (call, input, args) => fromBoolean(isType(input, typeArg(args, 0), call.ctx)),
});

/**
 * `as(type)`: the single input item if it is of the type, otherwise empty.
 *
 * @see https://hl7.org/fhirpath/N1/#astype-type-specifier
 */
export const asFunction: FunctionDefinition = defineFunction({
  name: 'as',
  params: [{ kind: 'type', name: 'type' }],
  input: { singleton: true },
  returns: { singleton: true },
  impl: (call, input, args) => asType(input, typeArg(args, 0), call.ctx),
});

/** The type functions of the standard library. */
export const TYPE_FUNCTIONS: readonly FunctionDefinition[] = Object.freeze([
  isFunction,
  asFunction,
]);
