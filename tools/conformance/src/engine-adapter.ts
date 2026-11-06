/**
 * The adapter that `pnpm conformance` and `pnpm test:conformance` use: the engine's internal
 * `compile()`/`evaluate()` (T0008). T0025 switches it to the public API, and T0018 adds the FHIR
 * models and the lossless `parseInput`. See `tools/conformance/README.md` for the contract.
 *
 * This is the only file of the runner that imports the engine. It imports engine sources directly,
 * because the internal API is not part of the published package.
 */
import { compile } from '../../../packages/core/src/api/compile.ts';
import {
  FhirPathEvaluationError,
  FhirPathSemanticError,
  FhirPathSyntaxError,
} from '../../../packages/core/src/errors/fhirpath-error.ts';
import { createRegistry } from '../../../packages/core/src/functions/registry.ts';
import { ModelNode } from '../../../packages/core/src/model/model-node.ts';
import type { ExpressionNode } from '../../../packages/core/src/parser/ast.ts';
import { parse } from '../../../packages/core/src/parser/parser.ts';
import type { Item } from '../../../packages/core/src/runtime/collection.ts';
import { toSystemValue } from '../../../packages/core/src/runtime/node-value.ts';
import { systemTypeOf } from '../../../packages/core/src/runtime/type-target.ts';
import { Quantity } from '../../../packages/core/src/values/quantity/quantity.ts';
import type { ClassifiedError, EvaluatorAdapter, ResultItem } from './adapter.ts';
import { NotImplementedError } from './stub-adapter.ts';

/**
 * Functions of the spec that later tasks implement, with the task. A test that calls one of them
 * before it exists is "not implemented", not an unknown function: otherwise a test that expects a
 * semantic error would pass for the wrong reason, and fail again once the function exists.
 */
const PLANNED_FUNCTIONS: Readonly<Record<string, string>> = {
  ...tasks('T0011', 'empty exists all allTrue anyTrue allFalse anyFalse subsetOf supersetOf'),
  ...tasks('T0011', 'count distinct isDistinct'),
  ...tasks('T0012', 'where select repeat ofType'),
  ...tasks('T0013', 'single first last tail skip take intersect exclude union combine'),
  ...tasks('T0014', 'iif toBoolean convertsToBoolean toInteger convertsToInteger toDecimal'),
  ...tasks('T0014', 'convertsToDecimal toDate convertsToDate toDateTime convertsToDateTime'),
  ...tasks('T0014', 'toTime convertsToTime toString convertsToString toQuantity'),
  ...tasks('T0014', 'convertsToQuantity'),
  ...tasks('T0015', 'indexOf substring startsWith endsWith contains upper lower replace'),
  ...tasks('T0015', 'matches replaceMatches length toChars'),
  ...tasks('T0016', 'abs ceiling exp floor ln log power round sqrt truncate'),
  ...tasks('T0017', 'children descendants trace now timeOfDay today'),
  ...tasks('T0020', 'extension hasValue getValue resolve memberOf subsumes subsumedBy'),
  ...tasks('T0020', 'conformsTo htmlChecks'),
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
  { pattern: /^(?:resource|rootResource|sct|loinc|vs-.*|ext-.*)$/, task: 'T0020' },
  { pattern: /^(?:terminologies|server|factory)$/, task: 'T0032' },
];

function tasks(task: string, names: string): Record<string, string> {
  return Object.fromEntries(names.split(' ').map((name) => [name, task]));
}

const REGISTRY = createRegistry();

/**
 * Throws {@link NotImplementedError} when the expression calls a function of the spec that the
 * engine does not have yet. A syntax error is left to `compile()`.
 */
function checkImplemented(expression: string): void {
  let ast: ExpressionNode;
  try {
    ast = parse(expression);
  } catch {
    return;
  }
  const missing = findMissing(ast);
  if (missing !== undefined) {
    throw new NotImplementedError(missing);
  }
}

function findMissing(node: ExpressionNode): string | undefined {
  switch (node.kind) {
    case 'FunctionCall': {
      const task = PLANNED_FUNCTIONS[node.name];
      if (task !== undefined && REGISTRY.get(node.name) === undefined) {
        return `${node.name}() comes with ${task}`;
      }
      return firstMissing([node.target, ...node.args]);
    }
    case 'Member':
      return findMissing(node.target);
    case 'Indexer':
      return firstMissing([node.target, node.index]);
    case 'Unary':
      return findMissing(node.operand);
    case 'Binary':
      return firstMissing([node.left, node.right]);
    case 'TypeOperation':
      return findMissing(node.operand);
    case 'This':
    case 'Index':
    case 'Total':
      return node.target === null ? undefined : findMissing(node.target);
    case 'Literal':
    case 'Identifier':
    case 'Variable':
      return undefined;
    default:
      return assertNever(node);
  }
}

function firstMissing(nodes: readonly (ExpressionNode | null)[]): string | undefined {
  for (const node of nodes) {
    const missing = node === null ? undefined : findMissing(node);
    if (missing !== undefined) {
      return missing;
    }
  }
  return undefined;
}

export const engineAdapter: EvaluatorAdapter = {
  name: '@callis/core (internal API)',
  async evaluate(input, expression, options): Promise<readonly unknown[]> {
    checkImplemented(expression);
    let focus = input;
    if (options.context !== undefined) {
      checkImplemented(options.context);
      const selected = await compile(options.context).evaluateAsync(input, { output: 'typed' });
      if (selected.length !== 1) {
        throw new Error(`the context ${options.context} selected ${selected.length} items, not 1`);
      }
      // TODO(T0020): keep %resource and %rootResource as the whole input.
      focus = selected[0];
    }
    // TODO(T0018): evaluate with the R4 or R5 model, by options.fhirVersion.
    return compile(expression).evaluateAsync(focus, { output: 'typed' });
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
      // An operator (T0010) or a variable that a later task adds.
      const missing = error.code === 'eval/not-implemented' || isPlannedVariable(error);
      return { kind: missing ? 'not-implemented' : 'execution', code: error.code, message };
    }
    return { kind: 'other', code: undefined, message };
  },
};

/** Whether the error is for an undefined variable that a later task defines, such as `%resource`. */
function isPlannedVariable(error: FhirPathEvaluationError): boolean {
  if (error.code !== 'eval/undefined-variable' || error.span === undefined) {
    return false;
  }
  // The span covers the variable as written, such as %resource or %`vs-administrative-gender`.
  const written = error.expression?.slice(error.span.start + 1, error.span.end) ?? '';
  const name = written.replace(/^([`'"])(.*)\1$/, '$2');
  return PLANNED_VARIABLES.some(({ pattern }) => pattern.test(name));
}

/**
 * One result item for comparison. Without a model, input nodes are described by the System type
 * of their JSON value; an object has no type the suite names.
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

function assertNever(value: never): never {
  throw new Error(`Unexpected node ${JSON.stringify(value)}`);
}
