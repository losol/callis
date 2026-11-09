/**
 * FHIR's changes to equivalence (`~`) for complex values
 * ([R5 §2.1.9.1.6](https://hl7.org/fhir/R5/fhirpath.html#changes); the same in
 * [R4](https://hl7.org/fhir/R4/fhirpath.html#changes) and the
 * [R6 draft §2.1.9.5.1](https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html#changes)), through the
 * `modelEquivalence` extension point of the equivalence kernels (T0009). Equality (`=`) keeps the
 * rule of all child properties.
 */
import { ModelNode } from '../model/model-node.ts';
import type { ModelProvider, ModelTypeInfo } from '../model/model-provider.ts';
import type { Collection, Item } from '../runtime/collection.ts';
import {
  type EquivalenceContext,
  equivalent,
  itemEquivalent,
  type ModelEquivalence,
} from '../runtime/equality.ts';
import { navigateChildren } from '../runtime/navigation.ts';

/** The model namespace these rules apply to. */
const FHIR_NAMESPACE = 'FHIR';

const NO_ITEMS: Collection = Object.freeze([]);

/**
 * Equivalence of two FHIR complex values of the same type
 * ([R5 §2.1.9.1.6](https://hl7.org/fhir/R5/fhirpath.html#changes)):
 *
 * - A `Coding` is equivalent to another when their `system` and `code` are equivalent; `version`,
 *   `display`, `userSelected` and any other element are ignored.
 * - A `CodeableConcept` is equivalent to another when a `Coding` of one is equivalent to a
 *   `Coding` of the other; `text` is ignored, and one without codings is equivalent to none.
 * - Any other type compares all its elements for equivalence, except `id`.
 *
 * Elements are compared with `~`, so nested values follow these rules too, and strings compare
 * as string equivalence does ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#fhir-equivalence)).
 * Returns undefined, leaving the default rule, for nodes that are not typed by a FHIR model. The
 * kernels call it only for two typed nodes of the same type.
 */
export const fhirEquivalence: ModelEquivalence = (left, right, ctx) => {
  const model = ctx.model;
  const type = left.type;
  if (model === undefined || type === undefined || right.type === undefined) {
    return undefined;
  }
  if (type.namespace !== FHIR_NAMESPACE || right.type.namespace !== FHIR_NAMESPACE) {
    return undefined;
  }
  if (isTypeOrSubtype(model, type, 'Coding')) {
    return codingEquivalent(childrenByName(left, ctx), childrenByName(right, ctx), ctx);
  }
  if (isTypeOrSubtype(model, type, 'CodeableConcept')) {
    return codingsIntersect(
      childrenByName(left, ctx).get('coding') ?? NO_ITEMS,
      childrenByName(right, ctx).get('coding') ?? NO_ITEMS,
      ctx,
    );
  }
  return elementsEquivalent(childrenByName(left, ctx), childrenByName(right, ctx), ctx);
};

function isTypeOrSubtype(model: ModelProvider, type: ModelTypeInfo, name: string): boolean {
  const ancestor = model.getType(name);
  return ancestor !== undefined && model.isSubtypeOf(type, ancestor);
}

/** The element values of a typed node, by element name, as model navigation gives them. */
function childrenByName(node: ModelNode, ctx: EquivalenceContext): ReadonlyMap<string, Collection> {
  const groups = new Map<string, Item[]>();
  for (const child of navigateChildren([node], ctx)) {
    // navigateChildren() only returns nodes; the name groups the items of a repeating element.
    const name = child instanceof ModelNode ? child.name : '';
    const group = groups.get(name);
    if (group === undefined) {
      groups.set(name, [child]);
    } else {
      group.push(child);
    }
  }
  return groups;
}

function codingEquivalent(
  left: ReadonlyMap<string, Collection>,
  right: ReadonlyMap<string, Collection>,
  ctx: EquivalenceContext,
): boolean {
  return (
    equivalent(left.get('system') ?? NO_ITEMS, right.get('system') ?? NO_ITEMS, ctx) &&
    equivalent(left.get('code') ?? NO_ITEMS, right.get('code') ?? NO_ITEMS, ctx)
  );
}

/** Whether some coding of one is equivalent to some coding of the other. */
function codingsIntersect(left: Collection, right: Collection, ctx: EquivalenceContext): boolean {
  return left.some((a) => right.some((b) => itemEquivalent(a, b, ctx)));
}

/** All elements equivalent, ignoring `id`; both must have values for the same elements. */
function elementsEquivalent(
  left: ReadonlyMap<string, Collection>,
  right: ReadonlyMap<string, Collection>,
  ctx: EquivalenceContext,
): boolean {
  let count = 0;
  for (const [name, items] of left) {
    if (name === 'id') {
      continue;
    }
    const other = right.get(name);
    if (other === undefined || !equivalent(items, other, ctx)) {
      return false;
    }
    count++;
  }
  const rightCount = right.has('id') ? right.size - 1 : right.size;
  return count === rightCount;
}
