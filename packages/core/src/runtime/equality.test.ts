import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { decimal, literal } from '../../test/support/literals.ts';
import { stubUnitSystem } from '../../test/support/stub-unit-system.ts';
import { ModelNode } from '../model/model-node.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import { minimalUnitSystem } from '../values/quantity/unit-system.ts';
import type { Collection, Item } from './collection.ts';
import {
  type EquivalenceContext,
  equals,
  equivalent,
  itemEquals,
  itemEquivalent,
  type ModelEquivalence,
} from './equality.ts';

const ctx: EquivalenceContext = { model: undefined, units: minimalUnitSystem, timezoneOffset: 0 };

function node(value: unknown, name = 'element'): ModelNode {
  return new ModelNode({ value, name });
}

/** A deep copy of JSON data: equal content, different objects. */
function copyJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function literals(...texts: string[]): Collection {
  return texts.map(literal);
}

/** `=` and `~` of two literals, checked in both operand orders. */
function expectEquality(
  a: Item,
  b: Item,
  equal: boolean | undefined,
  equivalentResult: boolean,
  context: EquivalenceContext = ctx,
): void {
  expect(itemEquals(a, b, context)).toBe(equal);
  expect(itemEquals(b, a, context)).toBe(equal);
  expect(itemEquivalent(a, b, context)).toBe(equivalentResult);
  expect(itemEquivalent(b, a, context)).toBe(equivalentResult);
}

// One describe per row of the equality table in T0009:
// https://github.com/losol/callis/blob/main/docs/tasks/T0009-equality-kernels.md#equality-and-equivalence
// https://hl7.org/fhirpath/N1/#equals, https://hl7.org/fhirpath/N1/#equivalent
describe('equality and equivalence', () => {
  describe('either operand empty', () => {
    it.each<[Collection, Collection]>([
      [[], []], // testEquality2
      [[true], []], // testEquality3
      [[], [1]],
    ])('= of %j and %j is empty', (a, b) => {
      expect(equals(a, b, ctx)).toBeUndefined();
    });

    it.each<[Collection, Collection, boolean]>([
      [[], [], true], // testEquivalent2
      [[1], [], false], // testEquivalent3
      [[], [1], false], // testNotEquivalent3
    ])('~ of %j and %j is %s', (a, b, expected) => {
      expect(equivalent(a, b, ctx)).toBe(expected);
    });
  });

  describe('String', () => {
    it.each<[string, string, boolean, boolean]>([
      ["'a'", "'a'", true, true], // testEquality9, testEquivalent5
      ["'a'", "'A'", false, true], // testEquality10, testEquivalent6
      ["'a'", "'b'", false, false], // testEquality11, testEquivalent7
      ["'Straße'", "'STRASSE'", false, true], // spec notes: string equivalence
    ])('%s and %s: = is %s, ~ is %s', (a, b, equal, equivalentResult) => {
      expectEquality(literal(a), literal(b), equal, equivalentResult);
    });

    // https://hl7.org/fhirpath/N1/#string-equivalence
    it('normalizes whitespace for ~ only, without collapsing runs', () => {
      expectEquality('a\tb', 'a b', false, true);
      expectEquality('a  b', 'a b', false, false);
    });
  });

  describe('Integer and Decimal', () => {
    it.each<[string, string, boolean, boolean]>([
      ['1', '1', true, true], // testEquality1, testEquivalent1
      ['1', '2', false, false], // testEquality8, testEquivalent4
      ['1.1', '1.1', true, true], // testEquality12, testEquivalent8
      ['1.1', '1.2', false, false], // testEquality13, testEquivalent9
      ['1.10', '1.1', true, true], // testEquality14, testEquivalent10
      ['0', '0', true, true], // testEquality15, testEquivalent12
      ['0.0', '0', true, true], // testEquality16, testEquivalent13
      ['1', '1.0', true, true], // T0009 acceptance criterion
      ['100', '1.0', false, false], // testEquality31
      ['10', '1.0', false, false], // testEquality32
      ['10', '10.0', true, true], // testEquality33
      ['1.50', '1.5', true, true], // testEquality34
      ['1', '1.4', false, true], // ~ rounds 1.4 to the precision of 1
      ['1', '1.5', false, false], // and 1.5 rounds half away from zero, to 2
      ['1.0', '1.04', false, true], // spec notes: rounding in decimal equivalence
    ])('%s and %s: = is %s, ~ is %s', (a, b, equal, equivalentResult) => {
      expectEquality(literal(a), literal(b), equal, equivalentResult);
    });

    it('rounds a recurring quotient for ~ but not for =', () => {
      const quotient = decimal('1.2').divide(decimal('1.8'));
      expect(quotient).toBeDefined();
      if (quotient !== undefined) {
        expectEquality(quotient, decimal('0.67'), false, true); // testEquivalent11
        expectEquality(quotient, decimal('0.6'), false, false); // testNotEquivalent13
      }
    });
  });

  describe('Boolean', () => {
    it.each<[string, string, boolean, boolean]>([
      ['true', 'true', true, true],
      ['false', 'false', true, true],
      ['true', 'false', false, false],
      ['true', "'true'", false, false], // different types are never equal
      ['true', '1', false, false],
    ])('%s and %s: = is %s, ~ is %s', (a, b, equal, equivalentResult) => {
      expectEquality(literal(a), literal(b), equal, equivalentResult);
    });
  });

  // https://hl7.org/fhirpath/N1/#datetime-equality and #datetime-equivalence
  // Long is phase 2 (T0028); until then, Longs only equal Longs.
  it('compares two Longs by value', () => {
    expectEquality(1n, 1n, true, true);
    expectEquality(1n, 2n, false, false);
    expectEquality(1n, 'a', false, false);
  });

  describe('Date, DateTime and Time', () => {
    it.each<[string, string, boolean | undefined, boolean]>([
      ['@2012-04-15', '@2012-04-15', true, true], // testEquality17, testEquivalent14
      ['@2012-04-15', '@2012-04-16', false, false], // testEquality18, testEquivalent15
      ['@2012-04-15', '@2012-04-15T10:00:00', undefined, false], // testEquality19, testEquivalent16
      ['@2012-04-15', '@2012-04-15T', true, true], // a Date converts to a DateTime
      ['@2012-04-15T15:00:00', '@2012-04-15T10:00:00', false, false], // testEquality20
      ['@2012-04-15T15:30:31', '@2012-04-15T15:30:31.0', true, true], // testEquality21, testEquivalent17
      ['@2012-04-15T15:30:31', '@2012-04-15T15:30:31.1', false, false], // testEquality22, testEquivalent18
      ['@2012-04-15T15:00:00+02:00', '@2012-04-15T16:00:00+03:00', true, true], // testEquality24
      ['@2015-02-04T10:00:00', '@2015-02-04T10:00', undefined, false], // testEquality39
      ['@2012', '@2012', true, true], // N1 Date/Time equality examples
      ['@2012', '@2013', false, false],
      ['@2012-01', '@2012', undefined, false],
      ['@T10:30', '@T10:30', true, true],
      ['@T10:30', '@T10:31', false, false],
      ['@T10:30', '@T10:30:00', undefined, false],
      ['@T10:30:00', '@T10:30:00.0', true, true],
      ['@T10:00', '@2012-01-01T10:00', false, false], // a Time is never a DateTime
      ['@T10', '@2012', false, false],
      ["'2012-04-15'", '@2012-04-15', false, false], // a String literal is never a date
    ])('%s and %s: = is %s, ~ is %s', (a, b, equal, equivalentResult) => {
      expectEquality(literal(a), literal(b), equal, equivalentResult);
    });

    // https://github.com/losol/callis/blob/main/docs/adr/0012-evaluation-defaults.md
    it('reads values without an offset at the timezone offset of the evaluation', () => {
      const a = literal('@2012-04-15T15:00:00Z');
      const b = literal('@2012-04-15T10:00:00');
      expectEquality(a, b, false, false); // testEquality23 at the UTC default
      expectEquality(a, b, true, true, { ...ctx, timezoneOffset: -300 });
    });
  });

  // https://hl7.org/fhirpath/STU3/#quantity-equality and #quantity-equivalence
  describe('Quantity', () => {
    it.each<[string, string, boolean | undefined, boolean]>([
      ['7 days', "1 'wk'", true, true], // testQuantity6
      ['1 second', "1 's'", true, true],
      ['1 year', "1 'a'", undefined, true], // testEquality36, testEquivalent25
      ['2 years', "2 'a'", undefined, true], // testEquivalent26
      ['1 month', "1 'mo'", undefined, true], // testEquivalent27
      ['1 year', '1 day', false, false], // testEquivalent28
      ["1 'x'", '1 year', undefined, false], // testEquivalent29
      ['1 year', "1 'kg'", undefined, false], // testEquivalent30
      ["1 'mg'", "1 'mg'", true, true],
      ["1 'mg'", "2 'mg'", false, false],
      ['23', "23 '1'", true, true], // 3.0.0 example: Integer converts to Quantity
      ['2.50', "2.5 '1'", true, true], // Decimal converts to Quantity
      ['1', "1 'mg'", undefined, false],
      ["1 'mg'", "'1 mg'", false, false], // a String is not a Quantity
    ])('%s and %s: = is %s, ~ is %s', (a, b, equal, equivalentResult) => {
      expectEquality(literal(a), literal(b), equal, equivalentResult);
    });

    it('uses the unit system of the evaluation', () => {
      const a = literal("100 'cm'");
      const b = literal("1 'm'");
      expectEquality(a, b, undefined, false);
      expectEquality(a, b, true, true, { ...ctx, units: stubUnitSystem });
    });
  });

  // https://hl7.org/fhirpath/N1/#equals: "For complex types, equality requires all child
  // properties to be equal, recursively."
  describe('complex values without a model', () => {
    const name = { use: 'official', given: ['Peter', 'James'], family: 'Chalmers' };

    it('is true for the same object', () => {
      expectEquality(node(name), node(name), true, true); // testEquality25, testEquivalent19
    });

    it('compares child properties recursively', () => {
      expectEquality(node(name), node(copyJson(name)), true, true);
      expectEquality(node(name), node({ ...name, family: 'Windsor' }), false, false);
      expectEquality(node(name), node({ ...name, family: 'CHALMERS' }), false, true);
      const nested = { coding: [{ system: 'http://loinc.org', code: '1234-5', display: 'A' }] };
      const changed = { coding: [{ system: 'http://loinc.org', code: '1234-5', display: 'a' }] };
      expectEquality(node(nested), node(copyJson(nested)), true, true);
      expectEquality(node(nested), node(changed), false, true);
    });

    it('compares repeating children in order for = and in any order for ~', () => {
      const reordered = { ...name, given: ['James', 'Peter'] };
      expectEquality(node(name), node(reordered), false, true);
    });

    it('is false when one value has a property the other lacks', () => {
      expectEquality(node(name), node({ ...name, text: 'Peter Chalmers' }), false, false);
      expectEquality(node({ a: 1 }), node({ b: 1 }), false, false);
    });

    it('ignores the order of properties', () => {
      expectEquality(node({ a: 1, b: 2 }), node({ b: 2, a: 1 }), true, true);
    });

    it('treats null, an empty array and a missing property alike, as navigation does', () => {
      expectEquality(node({ a: 1, b: null }), node({ a: 1 }), true, true);
      expectEquality(node({ a: 1, b: [] }), node({ a: 1 }), true, true);
      expectEquality(node({ a: 1, b: [null] }), node({ a: 1, b: [] }), true, true);
      expectEquality(node({ a: [1] }), node({ a: 1 }), true, true);
      expectEquality(node({ a: [null, 1] }), node({ a: 1 }), true, true);
      expectEquality(node({}), node({ b: null }), true, true);
    });

    it('compares child numbers by value and child strings exactly', () => {
      expectEquality(node({ value: 1 }), node({ value: 1.0 }), true, true);
      expectEquality(node({ value: 1 }), node({ value: 1.4 }), false, true);
      expectEquality(node({ value: 1 }), node({ value: '1' }), false, false);
    });

    it('never reads a date from a child string', () => {
      expectEquality(node({ d: '2012-04-15' }), node({ d: '2012-04-15T00:00:00' }), false, false);
    });

    it('reads only own properties', () => {
      const inherited: object = Object.create({ a: 1 });
      expectEquality(node(inherited), node({}), true, true);
      // JSON.parse makes "__proto__" an own property, not the prototype.
      const ownProto: unknown = JSON.parse('{"__proto__": {"a": 1}}');
      expectEquality(node(ownProto), node(JSON.parse('{"__proto__": {"a": 1}}')), true, true);
      expectEquality(node(ownProto), node(JSON.parse('{"__proto__": {"a": 2}}')), false, false);
      expectEquality(node(ownProto), node({}), false, false);
    });

    it('ignores array entries that a sparse array inherits', () => {
      // `new Array(1)` has no own index 0; its prototype supplies one.
      const inheriting = (): unknown[] => {
        const array: unknown[] = new Array(1);
        Object.setPrototypeOf(array, Object.assign(Object.create(Array.prototype), { 0: 'ghost' }));
        return array;
      };
      expectEquality(node({ a: inheriting() }), node({ a: ['ghost'] }), false, false);
      expectEquality(node({ a: inheriting() }), node({}), true, true);
      expectEquality(node({ a: [inheriting(), 'x'] }), node({ a: ['x'] }), true, true);
      expectEquality(node({ a: [inheriting()] }), node({ a: [['ghost']] }), false, false);
      expectEquality(node({ a: [inheriting()] }), node({}), true, true);
      // An own entry after an inherited hole: only the own entry counts.
      const partly = inheriting();
      partly[1] = 1;
      expectEquality(node({ a: partly }), node({ a: [1] }), true, true);
      expectEquality(node({ a: partly }), node({ a: ['ghost', 1] }), false, false);
    });

    // testEquality29, testEquality30, testNEquality25, testNEquality26
    it('is false between a complex value and a primitive', () => {
      expectEquality(node(name), 'Peter', false, false);
      expectEquality(node(name), node('Peter'), false, false);
      expectEquality(node(name), 1, false, false);
    });
  });

  // FHIR's rules use this hook (T0020): https://hl7.org/fhir/R5/fhirpath.html#changes
  describe('model-specific equivalence', () => {
    const codingEquivalence: ModelEquivalence = (left, right) => {
      const a = left.value;
      const b = right.value;
      if (isCoding(a) && isCoding(b)) {
        return a.system === b.system && a.code === b.code;
      }
      return undefined;
    };
    const fhir: EquivalenceContext = { ...ctx, modelEquivalence: codingEquivalence };
    const coding = { system: 'http://loinc.org', code: '1234-5', display: 'One' };
    const otherDisplay = { ...coding, display: 'Two' };

    it('decides ~ for the values it knows', () => {
      expectEquality(node(coding), node(otherDisplay), false, true, fhir);
      expectEquality(node(coding), node({ ...coding, code: '9' }), false, false, fhir);
      expectEquality(node(coding), node(otherDisplay), false, false);
    });

    it('applies to complex values nested in others', () => {
      const concept = { coding: [coding], text: 'x' };
      expectEquality(node(concept), node({ coding: [otherDisplay], text: 'X' }), false, true, fhir);
    });

    it('falls back to the default comparison when it returns undefined', () => {
      expectEquality(node({ a: 'x' }), node({ a: 'X' }), false, true, fhir);
      expectEquality(node({ a: 'x' }), node({ a: 'y' }), false, false, fhir);
    });

    it('is called with both nodes and the context, and not for the same object', () => {
      const hook = vi.fn<ModelEquivalence>(() => true);
      const context: EquivalenceContext = { ...ctx, modelEquivalence: hook };
      const a = node({ a: 1 });
      const b = node({ a: 2 });
      expect(itemEquivalent(a, b, context)).toBe(true);
      expect(hook).toHaveBeenCalledWith(a, b, context);
      hook.mockClear();
      expect(itemEquivalent(a, node(a.value), context)).toBe(true);
      expect(itemEquals(a, b, context)).toBe(false);
      expect(hook).not.toHaveBeenCalled();
    });
  });

  // https://hl7.org/fhirpath/STU3/en/index.html#-equals and https://hl7.org/fhirpath/N1/#equivalent
  describe('collections with several items', () => {
    it.each<[readonly string[], readonly string[], boolean | undefined]>([
      [['1', '2'], ['1', '2'], true], // testEquality5
      [['1', '2', '3'], ['1', '2', '3'], true], // testEquality6
      [['1'], ['1', '2'], false], // testEquality7: (1 | 1) = (1 | 2 | {})
      [['1', '2', '3'], ['3', '2', '1'], false], // 3.0.0 example: order matters
      [['1', '@2012'], ['1', '@2012-01'], undefined], // no false pair, one unknown
      [['2', '@2012'], ['1', '@2012-01'], false], // a false pair decides
      [['@2012', '2'], ['@2012-01', '1'], false], // in any position
    ])('(%s) = (%s) is %s', (a, b, expected) => {
      expect(equals(literals(...a), literals(...b), ctx)).toBe(expected);
      expect(equals(literals(...b), literals(...a), ctx)).toBe(expected);
    });

    it.each<[readonly string[], readonly string[], boolean]>([
      [['1', '2', '3'], ['1', '2', '3'], true], // testEquivalent23
      [['1', '2', '3'], ['3', '2', '1'], true], // testEquivalent24
      [["'a'", "'b'"], ["'B'", "'A'"], true],
      [['1', '2'], ['1', '2', '3'], false], // different lengths
      [['1', '1', '2'], ['1', '2', '2'], false], // each item is paired once
      [['1', '1.2'], ['1.2', '1.4'], true], // greedy pairing would fail
      [['1.2', '1'], ['1.2', '1.4'], true],
      [['1', '1.2', '2'], ['1.2', '2', '1.4'], true],
      [['1', '1.2', '1.24'], ['1.24', '1.4', '1.2'], true], // a longer chain
      [['1.2', '1.6'], ['1', '1'], false], // 1.6 rounds to 2
      [['@2012', '1'], ['1', '@2012-01'], false],
    ])('(%s) ~ (%s) is %s', (a, b, expected) => {
      expect(equivalent(literals(...a), literals(...b), ctx)).toBe(expected);
      expect(equivalent(literals(...b), literals(...a), ctx)).toBe(expected);
    });

    it('pairs large collections in any order', () => {
      const items = Array.from({ length: 1000 }, (_, index) => index);
      const reversed = [...items].reverse();
      expect(equivalent(items, reversed, ctx)).toBe(true);
      expect(equivalent(items, [...reversed.slice(1), 1000], ctx)).toBe(false);
    });

    it('agrees with trying every pairing', () => {
      // One-digit decimals near 1 make equivalence often non-transitive.
      const items = fc.constantFrom('1', '2', '1.0', '1.2', '1.4', '1.5', '1.24', '1.25', '2.0');
      const lists = fc
        .integer({ min: 1, max: 5 })
        .chain((length) =>
          fc.tuple(
            fc.array(items, { minLength: length, maxLength: length }),
            fc.array(items, { minLength: length, maxLength: length }),
          ),
        );
      fc.assert(
        fc.property(lists, ([a, b]) => {
          const left = literals(...a);
          const right = literals(...b);
          expect(equivalent(left, right, ctx)).toBe(somePermutationPairs(left, right));
        }),
        { numRuns: 400 },
      );
    });
  });

  describe('laws', () => {
    const options = { numRuns: 300 };
    const values = fc.oneof(
      fc.integer({ min: -100, max: 100 }),
      fc
        .tuple(fc.bigInt({ min: -10000n, max: 10000n }), fc.integer({ min: 0, max: 3 }))
        .map(([coefficient, scale]) => Decimal.of(coefficient, scale)),
      fc.string({ maxLength: 3 }),
      fc.boolean(),
    );

    it('is symmetric and reflexive', () => {
      fc.assert(
        fc.property(values, values, (a, b) => {
          expect(itemEquals(a, b, ctx)).toBe(itemEquals(b, a, ctx));
          expect(itemEquivalent(a, b, ctx)).toBe(itemEquivalent(b, a, ctx));
          expect(itemEquals(a, a, ctx)).toBe(true);
          expect(itemEquivalent(a, a, ctx)).toBe(true);
        }),
        options,
      );
    });

    it('makes equal values equivalent', () => {
      fc.assert(
        fc.property(values, values, (a, b) => {
          if (itemEquals(a, b, ctx) === true) {
            expect(itemEquivalent(a, b, ctx)).toBe(true);
          }
        }),
        options,
      );
    });
  });

  describe('input nodes that have only extensions', () => {
    const extensionOnly = new ModelNode({
      value: undefined,
      name: 'birthDate',
      primitiveElement: { extension: [] },
    });

    it('make = empty', () => {
      expect(itemEquals(extensionOnly, literal('@2012'), ctx)).toBeUndefined();
      expect(itemEquals(literal("'a'"), extensionOnly, ctx)).toBeUndefined();
    });

    it('are equivalent only to each other', () => {
      expect(itemEquivalent(extensionOnly, extensionOnly, ctx)).toBe(true);
      expect(itemEquivalent(extensionOnly, literal('@2012'), ctx)).toBe(false);
      expect(itemEquivalent(literal("'a'"), extensionOnly, ctx)).toBe(false);
    });
  });
});

function isCoding(value: unknown): value is { readonly system: unknown; readonly code: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.hasOwn(value, 'system') &&
    Object.hasOwn(value, 'code')
  );
}

/** Whether some ordering of `right` is pairwise equivalent to `left`, by trying them all. */
function somePermutationPairs(left: Collection, right: Collection): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const used = new Array<boolean>(right.length).fill(false);
  const search = (index: number): boolean => {
    const item = left[index];
    if (item === undefined) {
      return true;
    }
    for (let candidate = 0; candidate < right.length; candidate++) {
      const other = right[candidate];
      if (!used[candidate] && other !== undefined && itemEquivalent(item, other, ctx)) {
        used[candidate] = true;
        if (search(index + 1)) {
          return true;
        }
        used[candidate] = false;
      }
    }
    return false;
  };
  return search(0);
}
