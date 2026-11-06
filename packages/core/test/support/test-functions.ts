/**
 * Test-only functions that exercise the function machinery before the real library exists
 * (T0011–T0017): lambda arguments evaluated per item and lazily, and host results that are
 * promises or other thenables.
 */
import {
  defineFunction,
  type FunctionDefinition,
  lambdaArg,
  valueArg,
} from '../../src/functions/define.ts';
import { createRegistry, type FunctionRegistry } from '../../src/functions/registry.ts';
import { type Collection, EMPTY } from '../../src/runtime/collection.ts';
import { asBoolean } from '../../src/runtime/item-conversion.ts';
import { andThen, mapSequential } from '../../src/runtime/maybe-promise.ts';
import { singleton } from '../../src/runtime/singleton.ts';

/** `testWhere(criteria)`: the items for which the criteria is true, like `where()`. */
export const testWhere: FunctionDefinition = defineFunction({
  name: 'testWhere',
  params: [{ kind: 'lambda', name: 'criteria' }],
  impl: (_call, input, args) => {
    const criteria = lambdaArg(args, 0);
    if (criteria === undefined) {
      return EMPTY;
    }
    return andThen(
      mapSequential(input, (item, index) => criteria.forItem(item, index)),
      (results) => input.filter((_item, index) => isTrue(results[index] ?? EMPTY)),
    );
  },
});

/** `testSelect(projection)`: the projection of every item, flattened, like `select()`. */
export const testSelect: FunctionDefinition = defineFunction({
  name: 'testSelect',
  params: [{ kind: 'lambda', name: 'projection' }],
  impl: (_call, input, args) => {
    const projection = lambdaArg(args, 0);
    if (projection === undefined) {
      return EMPTY;
    }
    return andThen(
      mapSequential(input, (item, index) => projection.forItem(item, index)),
      (results) => results.flat(),
    );
  },
});

/**
 * `testIif(criterion, then, else)`: only the branch the criterion selects is evaluated, like
 * `iif()` (T0014).
 */
export const testIif: FunctionDefinition = defineFunction({
  name: 'testIif',
  params: [
    { kind: 'value', name: 'criterion' },
    { kind: 'lambda', name: 'then' },
    { kind: 'lambda', name: 'else', optional: true },
  ],
  impl: (_call, _input, args) => {
    const branch = isTrue(valueArg(args, 0)) ? lambdaArg(args, 1) : lambdaArg(args, 2);
    return branch === undefined ? EMPTY : branch.inPlace();
  },
});

/** `testAsync()`: the input, but through a native promise, like an async host function. */
export const testAsync: FunctionDefinition = defineFunction({
  name: 'testAsync',
  params: [],
  async: true,
  impl: (_call, input) => Promise.resolve(input),
});

/** `testThenable()`: the input, through a custom thenable that is not a promise. */
export const testThenable: FunctionDefinition = defineFunction({
  name: 'testThenable',
  params: [],
  async: true,
  impl: (_call, input) => customThenable(input),
});

/** A minimal Promises/A+ style thenable that resolves on a later microtask. */
export function customThenable<T>(value: T): PromiseLike<T> {
  return {
    // biome-ignore lint/suspicious/noThenProperty: a thenable is exactly what this test needs.
    then<R1 = T, R2 = never>(
      onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
      onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
    ): PromiseLike<R1 | R2> {
      return Promise.resolve()
        .then(() => value)
        .then(onFulfilled, onRejected);
    },
  };
}

/** A registry with the standard library and the test functions. */
export function testRegistry(...extra: readonly FunctionDefinition[]): FunctionRegistry {
  return createRegistry().extend([
    testWhere,
    testSelect,
    testIif,
    testAsync,
    testThenable,
    ...extra,
  ]);
}

/** A host function `name()` that returns whatever `result` gives for the input. */
export function hostFunction(
  name: string,
  result: (input: Collection) => Collection | PromiseLike<Collection>,
): FunctionDefinition {
  return defineFunction({ name, params: [], async: true, impl: (_call, input) => result(input) });
}

function isTrue(collection: Collection): boolean {
  return singleton(collection, 'Boolean', asBoolean) === true;
}
