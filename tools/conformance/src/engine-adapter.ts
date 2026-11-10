/**
 * The adapter that `pnpm conformance` and `pnpm test:conformance` use: the engine's internal
 * `compile()`/`evaluate()` (T0008) with the generated FHIR model of each suite file and the
 * lossless JSON parser (T0018). T0038 switches it to the public API. See
 * `tools/conformance/README.md` for the contract.
 *
 * This is the only file of the runner that imports the engine. It imports engine sources directly,
 * because the internal API is not part of the published package. It evaluates with the full UCUM
 * unit system of `@callis/ucum` and the `@callis/fhir-r4` and `@callis/fhir-r5` providers, also
 * from source, as T0006 requires of the runner, and with the fake host hooks of `fake-hooks.ts`
 * (T0021), so the hook-backed functions are measured too.
 */
import { type CompileOptions, compile } from '../../../packages/core/src/api/compile.ts';
import { childNodes } from '../../../packages/core/src/compiler/nesting.ts';
import {
  FhirPathEvaluationError,
  FhirPathSemanticError,
  FhirPathSyntaxError,
} from '../../../packages/core/src/errors/fhirpath-error.ts';
import { createRegistry } from '../../../packages/core/src/functions/registry.ts';
import { parseJson } from '../../../packages/core/src/model/lossless-json.ts';
import { ModelNode } from '../../../packages/core/src/model/model-node.ts';
import type { ModelProvider } from '../../../packages/core/src/model/model-provider.ts';
import type { ExpressionNode } from '../../../packages/core/src/parser/ast.ts';
import { parse } from '../../../packages/core/src/parser/parser.ts';
import type { Item } from '../../../packages/core/src/runtime/collection.ts';
import type { EvaluationHooks } from '../../../packages/core/src/runtime/hooks.ts';
import { toSystemValue } from '../../../packages/core/src/runtime/node-value.ts';
import { systemTypeOf } from '../../../packages/core/src/runtime/type-target.ts';
import { Quantity } from '../../../packages/core/src/values/quantity/quantity.ts';
import { r4 } from '../../../packages/fhir-r4/src/index.ts';
import { r5 } from '../../../packages/fhir-r5/src/index.ts';
import { ucum } from '../../../packages/ucum/src/index.ts';
import type {
  ClassifiedError,
  EvaluationOptions,
  EvaluatorAdapter,
  ResultItem,
} from './adapter.ts';
import { fakeHooks } from './fake-hooks.ts';
import { NotImplementedError } from './stub-adapter.ts';
import type { SuiteId } from './suite.ts';

/**
 * Functions of the spec that later tasks implement, with the task. A test that calls one of them
 * before it exists is "not implemented", not an unknown function: otherwise a test that expects a
 * semantic error would pass for the wrong reason, and fail again once the function exists.
 */
const PLANNED_FUNCTIONS: Readonly<Record<string, string>> = {
  ...tasks('T0041', 'empty all allTrue anyTrue allFalse anyFalse subsetOf supersetOf'),
  ...tasks('T0041', 'distinct isDistinct'),
  ...tasks('T0042', 'select repeat ofType'),
  ...tasks('T0044', 'single first'),
  ...tasks('T0013', 'last tail skip take intersect exclude union combine'),
  ...tasks('T0014', 'iif toBoolean convertsToBoolean toInteger convertsToInteger toDecimal'),
  ...tasks('T0014', 'convertsToDecimal toDate convertsToDate toDateTime convertsToDateTime'),
  ...tasks('T0014', 'toTime convertsToTime toString convertsToString toQuantity'),
  ...tasks('T0014', 'convertsToQuantity'),
  ...tasks('T0015', 'indexOf substring startsWith endsWith contains upper lower replace'),
  ...tasks('T0015', 'matches replaceMatches length toChars'),
  ...tasks('T0016', 'abs ceiling exp floor ln log power round sqrt truncate'),
  ...tasks('T0017', 'children descendants trace now timeOfDay today'),
  ...tasks('T0020', 'extension hasValue getValue resolve'),
  ...tasks('T0026', 'aggregate sum min max avg defineVariable'),
  ...tasks('T0027', 'sort coalesce repeatAll pathname'),
  ...tasks('T0028', 'toLong convertsToLong'),
  ...tasks('T0029', 'lastIndexOf matchesFull encode decode escape unescape trim split join'),
  ...tasks('T0030', 'lowBoundary highBoundary precision comparable yearOf monthOf dayOf'),
  ...tasks('T0030', 'hourOf minuteOf secondOf millisecondOf timezoneOffsetOf dateOf timeOf'),
  ...tasks('T0030', 'duration difference'),
  ...tasks('T0031', 'type'),
  ...tasks('T0032', 'elementDefinition slice checkModifiers'),
};

/**
 * Environment variables that later tasks define, as name patterns, with the task. An
 * `eval/undefined-variable` error for one of them is "not implemented"; once the task defines the
 * variable, the error no longer happens.
 */
const PLANNED_VARIABLES: readonly { readonly pattern: RegExp; readonly task: string }[] = [
  { pattern: /^(?:terminologies|server|factory)$/, task: 'T0032' },
];

function tasks(task: string, names: string): Record<string, string> {
  return Object.fromEntries(names.split(' ').map((name) => [name, task]));
}

const REGISTRY = createRegistry();

/** The generated model of each suite file ([ADR-0008](../../../docs/adr/0008-model-provider.md)). */
const MODELS: Readonly<Record<SuiteId, ModelProvider>> = { r4, r5 };

/** The fake hooks for each suite file, with its model. */
const HOOKS: Readonly<Record<SuiteId, EvaluationHooks>> = {
  r4: fakeHooks(r4),
  r5: fakeHooks(r5),
};

/**
 * The options of every compile() for a test: UCUM units for the suite's quantities, the model of
 * the suite's FHIR version, and the choice-type suffix only for `mode="lenient/polymorphics"`
 * ([ADR-0012](../../../docs/adr/0012-evaluation-defaults.md)).
 */
function compileOptionsFor(options: EvaluationOptions): CompileOptions {
  return {
    units: ucum,
    model: MODELS[options.fhirVersion],
    lenient: { choiceSuffix: options.lenientChoiceSuffix },
  };
}

/**
 * Throws {@link NotImplementedError} when the expression calls a function of the spec that the
 * engine does not have yet. A syntax error is left to `compile()`.
 */
function checkImplemented(expression: string): void {
  for (const node of nodesOf(expression)) {
    if (node.kind !== 'FunctionCall') {
      continue;
    }
    // Own properties only: `constructor()` is an unknown function, not a planned one.
    if (Object.hasOwn(PLANNED_FUNCTIONS, node.name) && REGISTRY.get(node.name) === undefined) {
      throw new NotImplementedError(`${node.name}() comes with ${PLANNED_FUNCTIONS[node.name]}`);
    }
  }
}

/**
 * Every node of the parsed expression, without recursion, so a very deep expression cannot
 * overflow the stack here. Empty when the expression does not parse; `compile()` reports that.
 */
function nodesOf(expression: string): ExpressionNode[] {
  let root: ExpressionNode;
  try {
    root = parse(expression);
  } catch {
    return [];
  }
  const nodes: ExpressionNode[] = [];
  const pending = [root];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    nodes.push(node);
    pending.push(...childNodes(node));
  }
  return nodes;
}

export const engineAdapter: EvaluatorAdapter = {
  name: '@callis/core (internal API)',
  // The converted inputs keep the precision of decimals (T0023); so does the evaluation.
  parseInput: parseJson,
  async evaluate(input, expression, options): Promise<readonly unknown[]> {
    checkImplemented(expression);
    const compileOptions = compileOptionsFor(options);
    const hooks = HOOKS[options.fhirVersion];
    let focus = input;
    if (options.context !== undefined) {
      checkImplemented(options.context);
      const selected = await compile(options.context, compileOptions).evaluateAsync(input, {
        output: 'typed',
        hooks,
      });
      if (selected.length !== 1) {
        throw new Error(`the context ${options.context} selected ${selected.length} items, not 1`);
      }
      // The selected node keeps its parent chain, so %resource and %rootResource are still the
      // resources of the whole input (docs/tasks/T0020-fhir-functions.md).
      focus = selected[0];
    }
    return compile(expression, compileOptions).evaluateAsync(focus, { output: 'typed', hooks });
  },
  describeValue(value: unknown): ResultItem {
    return describeItem(value as Item);
  },
  classifyError(error: unknown): ClassifiedError {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof NotImplementedError) {
      return { kind: 'not-implemented', code: undefined, message };
    }
    if (error instanceof FhirPathSyntaxError) {
      return { kind: 'syntax', code: error.code, message };
    }
    if (error instanceof FhirPathSemanticError) {
      return { kind: 'semantic', code: error.code, message };
    }
    if (error instanceof FhirPathEvaluationError) {
      // A variable that a later task adds.
      const missing = isPlannedVariable(error);
      return { kind: missing ? 'not-implemented' : 'execution', code: error.code, message };
    }
    return { kind: 'other', code: undefined, message };
  },
};

/**
 * Whether the error is for an undefined variable that a later task defines, such as `%resource`.
 * The variable is the node of the parsed expression with the error's span, so its name is
 * decoded (`` %`\u0072esource` ``) and grouping (`(%resource)`) does not matter.
 */
function isPlannedVariable(error: FhirPathEvaluationError): boolean {
  const { span, expression } = error;
  if (error.code !== 'eval/undefined-variable' || span === undefined || expression === undefined) {
    return false;
  }
  return nodesOf(expression).some(
    (node) =>
      node.kind === 'Variable' &&
      node.span.start === span.start &&
      node.span.end === span.end &&
      PLANNED_VARIABLES.some(({ pattern }) => pattern.test(node.name)),
  );
}

/**
 * One result item for comparison. A typed node is described by its model type (`FHIR.code`), with
 * its System value as text when it has one. An untyped node, from data the model does not know,
 * is described by the System type of its JSON value; an object has no type the suite names.
 */
function describeItem(item: Item): ResultItem {
  if (item instanceof ModelNode) {
    const value = toSystemValue(item);
    if (item.type !== undefined) {
      const type = `${item.type.namespace}.${item.type.name}`;
      return value === undefined || value === item ? { type } : { ...describeValue(value), type };
    }
    if (value === undefined) {
      return { type: 'System.Any' };
    }
    return value === item ? { type: 'Object' } : describeValue(value);
  }
  return describeValue(item);
}

function describeValue(value: Item): ResultItem {
  const type = systemTypeOf(value);
  if (type === undefined) {
    return { type: 'Object' };
  }
  const name = `System.${type.name}`;
  if (value instanceof Quantity) {
    return { type: name, value: value.value.toString(), unit: value.unit };
  }
  return { type: name, value: String(value) };
}
