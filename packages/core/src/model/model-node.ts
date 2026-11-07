import type { SystemTypeName } from '../types/system-types.ts';
import type { DateValue } from '../values/datetime/date.ts';
import type { DateTimeValue } from '../values/datetime/datetime.ts';
import type { TimeValue } from '../values/datetime/time.ts';
import type { Decimal } from '../values/decimal/decimal.ts';
import type { Quantity } from '../values/quantity/quantity.ts';
import type { ModelTypeInfo } from './model-provider.ts';
import { convertNode } from './node-conversion.ts';

/**
 * The fields of a new {@link ModelNode}; each one sets the node field of the same name. Only
 * `value` and `name` are required, and the others default to `undefined`.
 */
export interface ModelNodeInit {
  /** The JSON value; pass `undefined` explicitly for a primitive that only has extensions. */
  readonly value: unknown;
  /** The element name the node is reached by. */
  readonly name: string;
  /** The model type, if known. */
  readonly type?: ModelTypeInfo | undefined;
  /**
   * The System type the model maps `type` to, if any: `Date` for a FHIR `date`, `Quantity` for a
   * FHIR `Quantity`. Navigation sets it from `ModelProvider.getSystemType()` together with `type`.
   */
  readonly systemType?: Exclude<SystemTypeName, 'Any'> | undefined;
  /** The node this one is navigated from. */
  readonly parent?: ModelNode | undefined;
  /** The position within a repeating element. */
  readonly index?: number | undefined;
  /** The matching `_name` object of a FHIR primitive. */
  readonly primitiveElement?: object | undefined;
}

/**
 * What a node converts to: a System value, or the node itself for a resource or complex value.
 * Every member is a collection item.
 */
export type SystemValue =
  | boolean
  | string
  | number
  | bigint
  | Decimal
  | DateValue
  | DateTimeValue
  | TimeValue
  | Quantity
  | ModelNode;

/** The memo value of a node whose System value has not been computed yet. */
const UNCONVERTED: unique symbol = Symbol('unconverted');

/**
 * A piece of input data in a collection: a resource, a complex value or a FHIR primitive, with
 * where it came from.
 *
 * Navigation creates nodes lazily (T0008 without a model, T0018 with one). It is a class so that
 * every node has the same shape, which keeps property access fast on the hot path; every field is
 * always set, to `undefined` when it does not apply. A node is never changed after it is created;
 * only its System value is computed on first use and remembered.
 */
export class ModelNode {
  /**
   * The JSON value: an object for resources and complex values, a string, number, boolean or
   * {@link JsonNumber} for primitives. Never an array; navigation flattens arrays into separate
   * nodes. Undefined for a FHIR primitive that has only extensions (`_birthDate` without
   * `birthDate`).
   */
  readonly value: unknown;
  /**
   * The element name the node was reached by, used by `trace()` and tree functions. For a root
   * node it is chosen by the caller, for example the resource type. A choice element is named
   * without its type suffix (`value`, not `valueQuantity`).
   */
  readonly name: string;
  /** The model type. Undefined without a model, or when the model does not know the type. */
  readonly type: ModelTypeInfo | undefined;
  /**
   * The System type that values of the model type convert to, from `ModelProvider.getSystemType()`.
   * Undefined without a model type, and for model types that do not convert (`HumanName`).
   */
  readonly systemType: Exclude<SystemTypeName, 'Any'> | undefined;
  /** The node this one was navigated from. Undefined for a root node. */
  readonly parent: ModelNode | undefined;
  /** The position within a repeating element. Undefined when the element does not repeat. */
  readonly index: number | undefined;
  /**
   * For a FHIR primitive, the matching `_name` object from the JSON, which holds `id` and
   * `extension` ([FHIR JSON](https://hl7.org/fhir/R4/json.html#primitive)). Undefined when
   * there is none.
   */
  readonly primitiveElement: object | undefined;

  #systemValue: SystemValue | undefined | typeof UNCONVERTED = UNCONVERTED;

  constructor(init: ModelNodeInit) {
    this.value = init.value;
    this.name = init.name;
    this.type = init.type;
    this.systemType = init.systemType;
    this.parent = init.parent;
    this.index = init.index;
    this.primitiveElement = init.primitiveElement;
  }

  /**
   * The System value of the node, converted on first use and remembered: the value a FHIR
   * primitive maps to (a `date` becomes a `DateValue`), a `Quantity` with a UCUM code, a plain JSON
   * primitive by its JavaScript type, or the node itself for a resource or complex value. Undefined
   * when the node holds nothing (a primitive with only extensions), which operations treat as
   * empty. The rules are in `node-conversion.ts`.
   */
  systemValue(): SystemValue | undefined {
    if (this.#systemValue === UNCONVERTED) {
      this.#systemValue = convertNode(this);
    }
    return this.#systemValue;
  }
}
