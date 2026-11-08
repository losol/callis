/**
 * The function registry: names to definitions, resolved at compile time
 * ([T0008: function library](https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md#function-library)).
 */
import { type FhirPathErrorOptions, FhirPathSemanticError } from '../errors/fhirpath-error.ts';
import { arityOf, defineFunction, type FunctionDefinition } from './define.ts';
import { EXISTENCE_FUNCTIONS } from './existence.ts';
import { FILTERING_FUNCTIONS } from './filtering.ts';
import { LOGIC_FUNCTIONS } from './logic.ts';
import { STRING_FUNCTIONS } from './string.ts';
import { SUBSETTING_FUNCTIONS } from './subsetting.ts';
import { TYPE_FUNCTIONS } from './types.ts';

/**
 * Looks up functions by name. Immutable: {@link FunctionRegistry.extend} returns a new registry,
 * so one registry can be shared by any number of compiled expressions.
 */
export interface FunctionRegistry {
  /** The definition named `name` (case-sensitive), or undefined. */
  get(name: string): FunctionDefinition | undefined;
  /**
   * The definition for a call of `name` with `arity` arguments. The compiler calls this once per
   * call in the expression.
   *
   * @param options - The span of the call and the expression text, for the error.
   * @throws {@link FhirPathSemanticError} `semantic/unknown-function` when there is no such
   *   function, `semantic/wrong-arity` when it does not take that many arguments.
   */
  resolve(name: string, arity: number, options?: FhirPathErrorOptions): FunctionDefinition;
  /**
   * A new registry with these functions added. A definition replaces one of the same name.
   *
   * @throws {@link FhirPathEvaluationError} `eval/invalid-argument` for an invalid definition.
   */
  extend(definitions: readonly FunctionDefinition[]): FunctionRegistry;
  /** The names of all functions, sorted. */
  names(): readonly string[];
}

/** Which built-in functions a new registry has. Both are on by default. */
export interface RegistryOptions {
  /** The FHIRPath standard library ([N1 §5](https://hl7.org/fhirpath/N1/#functions)). */
  readonly standard?: boolean;
  /** The FHIR additions ([R5 §2.1.9.1.5](https://hl7.org/fhir/R5/fhirpath.html#functions)); T0020. */
  readonly fhir?: boolean;
}

/** The standard library. Later tasks add their functions here (T0011–T0017). */
const STANDARD_FUNCTIONS: readonly FunctionDefinition[] = Object.freeze([
  ...EXISTENCE_FUNCTIONS,
  ...FILTERING_FUNCTIONS,
  ...LOGIC_FUNCTIONS,
  ...STRING_FUNCTIONS,
  ...SUBSETTING_FUNCTIONS,
  ...TYPE_FUNCTIONS,
]);

/** The FHIR functions (T0020). */
const FHIR_FUNCTIONS: readonly FunctionDefinition[] = Object.freeze([]);

/**
 * Creates a function registry with the standard library and the FHIR functions, or only the parts
 * asked for.
 *
 * @example
 * ```ts
 * const registry = createRegistry().extend([myFunction]);
 * const bare = createRegistry({ standard: false, fhir: false });
 * ```
 */
export function createRegistry(options: RegistryOptions = {}): FunctionRegistry {
  const definitions: FunctionDefinition[] = [];
  if (options.standard !== false) {
    definitions.push(...STANDARD_FUNCTIONS);
  }
  if (options.fhir !== false) {
    definitions.push(...FHIR_FUNCTIONS);
  }
  return new Registry(Object.create(null), definitions);
}

class Registry implements FunctionRegistry {
  readonly #functions: Readonly<Record<string, FunctionDefinition>>;

  constructor(
    base: Readonly<Record<string, FunctionDefinition>>,
    added: readonly FunctionDefinition[],
  ) {
    // A null prototype, so `toString` or `constructor` is a function only when defined.
    const functions: Record<string, FunctionDefinition> = Object.assign(Object.create(null), base);
    for (const definition of added) {
      const checked = defineFunction(definition);
      functions[checked.name] = checked;
    }
    this.#functions = Object.freeze(functions);
  }

  get(name: string): FunctionDefinition | undefined {
    return Object.hasOwn(this.#functions, name) ? this.#functions[name] : undefined;
  }

  resolve(name: string, arity: number, options?: FhirPathErrorOptions): FunctionDefinition {
    const definition = this.get(name);
    if (definition === undefined) {
      throw new FhirPathSemanticError(
        'semantic/unknown-function',
        `The function ${name}() is not defined`,
        options,
      );
    }
    const { min, max } = arityOf(definition);
    if (arity < min || arity > max) {
      throw new FhirPathSemanticError(
        'semantic/wrong-arity',
        `Expected ${describeArity(min, max)} for ${name}(), but found ${arity}`,
        options,
      );
    }
    return definition;
  }

  extend(definitions: readonly FunctionDefinition[]): FunctionRegistry {
    return new Registry(this.#functions, definitions);
  }

  names(): readonly string[] {
    return Object.keys(this.#functions).sort();
  }
}

function describeArity(min: number, max: number): string {
  const count = (n: number): string => `${n} argument${n === 1 ? '' : 's'}`;
  if (max === Number.POSITIVE_INFINITY) {
    return `at least ${count(min)}`;
  }
  return min === max ? count(min) : `${min} to ${count(max)}`;
}
