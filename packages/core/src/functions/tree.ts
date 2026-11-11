/**
 * The tree navigation functions `children()` and `descendants()`
 * ([N1 §5.8](https://hl7.org/fhirpath/N1/#tree-navigation)).
 *
 * Both list the nodes that `navigateChildren()` gives: with a model, the elements of a typed node
 * in definition order, with `_name` extensions folded into their primitives; without one, the own
 * JSON properties in document order, without `resourceType` and `_name` keys
 * ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#children-without-a-model)).
 */
import { type Collection, EMPTY, type Item } from '../runtime/collection.ts';
import { navigateChildren } from '../runtime/navigation.ts';
import { defineValueFunction, type FunctionDefinition, type TypeHint } from './define.ts';

/**
 * The order of the result is undefined, so strict analysis reports `first()`, `last()`,
 * `tail()`, `skip()`, `take()` and the indexer on it
 * ([N1 §3.1](https://hl7.org/fhirpath/N1/#collections)).
 */
const UNORDERED: TypeHint = { ordered: false };

/**
 * `children()`: the immediate child nodes of every input item, in order. Items that are not
 * input nodes, such as literals, have no children.
 *
 * @see https://hl7.org/fhirpath/N1/#children-collection
 */
export const childrenFunction: FunctionDefinition = defineValueFunction(
  'children',
  0,
  (input, _args, call) => navigateChildren(input, call.ctx),
  { returns: UNORDERED },
);

/**
 * `descendants()`: every node below the input items, without the input items themselves, in
 * document order: each node comes before its own descendants and after the descendants of the
 * nodes before it ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#order-of-descendants)).
 *
 * The walk follows the data, not the model's types, so it ends on a recursive type such as
 * `Questionnaire.item.item`. It keeps its own stack, so deep input cannot overflow the call stack.
 *
 * @see https://hl7.org/fhirpath/N1/#descendants-collection
 */
export const descendantsFunction: FunctionDefinition = defineValueFunction(
  'descendants',
  0,
  (input, _args, call) => {
    const items: Item[] = [];
    // The child lists still being walked, innermost last, each with the position of its next item.
    const pending: { readonly children: Collection; next: number }[] = [
      { children: navigateChildren(input, call.ctx), next: 0 },
    ];
    for (let level = pending.at(-1); level !== undefined; level = pending.at(-1)) {
      const item = level.children[level.next];
      if (item === undefined) {
        pending.pop();
        continue;
      }
      level.next++;
      items.push(item);
      const children = navigateChildren([item], call.ctx);
      if (children.length > 0) {
        pending.push({ children, next: 0 });
      }
    }
    return items.length === 0 ? EMPTY : items;
  },
  { returns: UNORDERED },
);

/** The tree navigation functions of the standard library. */
export const TREE_FUNCTIONS: readonly FunctionDefinition[] = Object.freeze([
  childrenFunction,
  descendantsFunction,
]);
