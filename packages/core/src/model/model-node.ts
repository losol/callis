import type { ModelTypeInfo } from './model-provider.ts';

/** The fields of a new {@link ModelNode}. Only `value` and `name` are required. */
export interface ModelNodeInit {
  readonly value: unknown;
  readonly name: string;
  readonly type?: ModelTypeInfo | undefined;
  readonly parent?: ModelNode | undefined;
  readonly index?: number | undefined;
  readonly primitiveElement?: object | undefined;
}

/**
 * A piece of input data in a collection: a resource, a complex value or a FHIR primitive, with
 * where it came from.
 *
 * This class holds structure only. Navigation creates nodes lazily (T0008 without a model, T0018
 * with one), and conversion to System values is added there. It is a class so that every node
 * has the same shape, which keeps property access fast on the hot path; every field is always
 * set, to `undefined` when it does not apply.
 */
export class ModelNode {
  /**
   * The JSON value: an object for resources and complex values, a string, number or boolean for
   * primitives. Never an array; navigation flattens arrays into separate nodes. Undefined for a
   * FHIR primitive that has only extensions (`_birthDate` without `birthDate`).
   */
  readonly value: unknown;
  /**
   * The element name the node was reached by, used by `trace()` and tree functions. For a root
   * node it is chosen by the caller, for example the resource type.
   */
  readonly name: string;
  /** The model type. Undefined without a model, or when the model does not know the type. */
  readonly type: ModelTypeInfo | undefined;
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

  constructor(init: ModelNodeInit) {
    this.value = init.value;
    this.name = init.name;
    this.type = init.type;
    this.parent = init.parent;
    this.index = init.index;
    this.primitiveElement = init.primitiveElement;
  }
}
