import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { literal } from '../../test/support/literals.ts';
import { stubModel, stubType } from '../../test/support/stub-model.ts';
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { ModelNode } from '../model/model-node.ts';
import { DateValue } from '../values/datetime/date.ts';
import { DateTimeValue } from '../values/datetime/datetime.ts';
import { TimeValue } from '../values/datetime/time.ts';
import { minimalUnitSystem } from '../values/quantity/unit-system.ts';
import { type Collection, concat, EMPTY, type Item } from './collection.ts';
import { compare, type Ordering } from './comparison.ts';
import {
  type EquivalenceContext,
  equals,
  equivalent,
  itemEquals,
  itemEquivalent,
} from './equality.ts';
import { toSystemValue } from './node-value.ts';
import { isTemporal, operandValue } from './operands.ts';

const modelLess: EquivalenceContext = {
  model: undefined,
  units: minimalUnitSystem,
  timezoneOffset: 0,
};
const withModel: EquivalenceContext = { ...modelLess, model: stubModel };

type Operator = '=' | '!=' | '~' | '!~' | '<' | '<=' | '>' | '>=';

/** The result of a binary operator on two single items, as T0010 builds it from the kernels. */
function apply(
  operator: Operator,
  a: Item,
  b: Item,
  ctx: EquivalenceContext = modelLess,
): boolean | undefined {
  switch (operator) {
    case '=':
      return itemEquals(a, b, ctx);
    case '!=': {
      const equal = itemEquals(a, b, ctx);
      return equal === undefined ? undefined : !equal;
    }
    case '~':
      return itemEquivalent(a, b, ctx);
    case '!~':
      return !itemEquivalent(a, b, ctx);
    default: {
      const order = compare(a, b, ctx);
      if (order === undefined) {
        return undefined;
      }
      switch (operator) {
        case '<':
          return order < 0;
        case '<=':
          return order <= 0;
        case '>':
          return order > 0;
        case '>=':
          return order >= 0;
      }
    }
  }
}

/** The same operator with its operands swapped: `a < b` is `b > a`. */
const SWAPPED: Readonly<Record<Operator, Operator>> = {
  '=': '=',
  '!=': '!=',
  '~': '~',
  '!~': '!~',
  '<': '>',
  '<=': '>=',
  '>': '<',
  '>=': '<=',
};

const OPERATORS: readonly Operator[] = ['=', '!=', '~', '!~', '<', '<=', '>', '>='];

/** A Patient as model-less navigation sees it: every JSON value is an untyped input node. */
const patient = new ModelNode({
  value: { resourceType: 'Patient', birthDate: '1974-12-25', t: '10:00:00' },
  name: 'Patient',
});

function input(value: string, name = 'element'): ModelNode {
  return new ModelNode({ value, name, parent: patient });
}

const birthDate = input('1974-12-25', 'birthDate');
const t = input('10:00:00', 't');

function expectTypeMismatch(run: () => unknown): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(FhirPathEvaluationError);
  expect(caught).toMatchObject({ code: 'eval/type-mismatch' });
}

// The Callis model-less date convenience:
// https://github.com/losol/callis/blob/main/docs/tasks/T0009-equality-kernels.md#model-less-date-convenience
// https://github.com/losol/callis/issues/55
describe('model-less date convenience', () => {
  // The examples of the T0009 acceptance criteria, on {"birthDate": "1974-12-25", "t": "10:00:00"}.
  it.each<[string, () => boolean | undefined]>([
    ['birthDate = @1974-12-25', () => apply('=', birthDate, literal('@1974-12-25'))],
    ['@1974-12-25 = birthDate', () => apply('=', literal('@1974-12-25'), birthDate)],
    ['birthDate ~ @1974-12-25', () => apply('~', birthDate, literal('@1974-12-25'))],
    ['birthDate < @2000', () => apply('<', birthDate, literal('@2000'))],
    ['@2000 > birthDate', () => apply('>', literal('@2000'), birthDate)],
    ['t = @T10:00:00', () => apply('=', t, literal('@T10:00:00'))],
  ])('%s is true', (_expression, evaluate) => {
    expect(evaluate()).toBe(true);
  });

  // Every operator, in both operand orders: `node op literal` and `literal swapped(op) node`.
  it.each<[string, string, Partial<Record<Operator, boolean | undefined>>]>([
    // Date text against a Date
    ['1974-12-25', '@1974-12-25', { '=': true, '~': true, '<': false, '<=': true, '>=': true }],
    ['1974-12-25', '@1974-12-26', { '=': false, '!=': true, '!~': true, '<': true, '>': false }],
    // Partial precision: equality and order are unknown, equivalence is false
    ['1974-12', '@1974-12-25', { '=': undefined, '!=': undefined, '~': false, '<': undefined }],
    ['1974', '@1975', { '=': false, '~': false, '<': true, '>=': false }],
    // DateTime text against a DateTime, respecting offsets
    ['1974-12-25T14:35:45-05:00', '@1974-12-25T19:35:45Z', { '=': true, '~': true, '<=': true }],
    ['1974-12-25T14:35:45-05:00', '@1975-01-01T00:00:00Z', { '=': false, '<': true }], // testLessThan28
    ['2012-04-15T10:00', '@2012-04-15T10:00', { '=': true, '>': false }],
    ['2012-04-15T10:00:00', '@2012-04-15T10:00', { '=': undefined, '~': false }],
    // Date → DateTime conversion in both directions
    ['1974-12-25', '@1974-12-25T10:00', { '=': undefined, '~': false, '<': undefined }],
    ['1974-12-24', '@1974-12-25T10:00', { '=': false, '<': true, '>': false }],
    ['1974-12-25T10:00:00Z', '@1974-12-25', { '=': undefined, '~': false, '>': undefined }],
    ['1974-12-26T10:00:00Z', '@1974-12-25', { '=': false, '>': true }],
    // Time text against a Time
    ['10:00:00', '@T10:00:00', { '=': true, '~': true, '>=': true }],
    ['10:00', '@T10:00:00', { '=': undefined, '~': false, '<': undefined }],
    ['09:59:59.999', '@T10:00:00', { '=': false, '<': true }],
  ])('reads input text %s against %s', (text, other, expected) => {
    const node = input(text);
    const value = literal(other);
    for (const operator of OPERATORS) {
      if (Object.hasOwn(expected, operator)) {
        expect(apply(operator, node, value), `${text} ${operator} ${other}`).toBe(
          expected[operator],
        );
        expect(apply(SWAPPED[operator], value, node), `${other} ${SWAPPED[operator]} ${text}`).toBe(
          expected[operator],
        );
      }
    }
  });

  // https://github.com/losol/callis/blob/main/docs/adr/0012-evaluation-defaults.md
  it('reads text without an offset at the timezone offset of the evaluation', () => {
    const local = input('2012-04-15T10:00:00');
    const utc = literal('@2012-04-15T15:00:00Z');
    expect(itemEquals(local, utc, modelLess)).toBe(false);
    expect(itemEquals(local, utc, { ...modelLess, timezoneOffset: -300 })).toBe(true);
    expect(itemEquals(utc, local, { ...modelLess, timezoneOffset: -300 })).toBe(true);
  });

  describe('keeps ordinary String semantics', () => {
    it('for a String literal that looks like a date', () => {
      // '1974-12-25' = @1974-12-25
      const text = literal("'1974-12-25'");
      expect(itemEquals(text, literal('@1974-12-25'), modelLess)).toBe(false);
      expect(itemEquivalent(literal('@1974-12-25'), text, modelLess)).toBe(false);
      expectTypeMismatch(() => compare(text, literal('@2000'), modelLess));
      expectTypeMismatch(() => compare(literal('@2000'), text, modelLess));
    });

    it('for a computed String', () => {
      const computed = ['1974', '12', '25'].join('-');
      expect(itemEquals(computed, literal('@1974-12-25'), modelLess)).toBe(false);
      expectTypeMismatch(() => compare(literal('@2000'), computed, modelLess));
    });

    it('for two input Strings, which compare as Strings', () => {
      const other = input('1974-12-25T00:00:00');
      expect(itemEquals(birthDate, input('1974-12-25'), modelLess)).toBe(true);
      expect(itemEquals(birthDate, other, modelLess)).toBe(false); // as dates it would be empty
      expect(compare(birthDate, other, modelLess)).toBe(-1); // a prefix comes first
      expect(itemEquivalent(input('ABC'), input('abc'), modelLess)).toBe(true);
    });

    it.each([
      '1974-13-45', // no such month
      '1974-02-30', // no such day
      'not a date',
      '1974-12-25T', // a T without a time
      '10:00:00Z', // a time with an offset is not a Time
      '',
    ])('for input text %j that does not parse', (text) => {
      const node = input(text);
      for (const other of ['@1974-12-25', '@1974-12-25T10:00', '@T10:00:00']) {
        expect(itemEquals(node, literal(other), modelLess)).toBe(false);
        expect(itemEquals(literal(other), node, modelLess)).toBe(false);
        expect(itemEquivalent(node, literal(other), modelLess)).toBe(false);
        expectTypeMismatch(() => compare(node, literal(other), modelLess));
        expectTypeMismatch(() => compare(literal(other), node, modelLess));
      }
      expect(operandValue(node, literal('@2012'), undefined)).toBe(text);
    });

    it('for Time text against a Date, and date text against a Time', () => {
      expect(itemEquals(t, literal('@1974-12-25'), modelLess)).toBe(false);
      expect(itemEquals(birthDate, literal('@T10:00:00'), modelLess)).toBe(false);
      expectTypeMismatch(() => compare(birthDate, literal('@T10:00:00'), modelLess));
    });

    it('for a typed node', () => {
      // A FHIR string stays a String, with or without a model.
      const typed = new ModelNode({ value: '1974-12-25', name: 'text', type: stubType('string') });
      for (const ctx of [modelLess, withModel]) {
        expect(itemEquals(typed, literal('@1974-12-25'), ctx)).toBe(false);
        expect(itemEquivalent(literal('@1974-12-25'), typed, ctx)).toBe(false);
        expectTypeMismatch(() => compare(typed, literal('@2000'), ctx));
      }
    });

    it('for an untyped node when a model is supplied', () => {
      expect(itemEquals(birthDate, literal('@1974-12-25'), withModel)).toBe(false);
      expect(itemEquals(literal('@1974-12-25'), birthDate, withModel)).toBe(false);
      expect(itemEquivalent(birthDate, literal('@1974-12-25'), withModel)).toBe(false);
      expectTypeMismatch(() => compare(birthDate, literal('@2000'), withModel));
      expectTypeMismatch(() => compare(literal('@2000'), birthDate, withModel));
    });
  });

  it('follows an input node through a projection', () => {
    // A function that selects or forwards an item passes the same node on.
    const forwarded = concat(EMPTY, [birthDate])[0];
    expect(forwarded).toBe(birthDate);
    if (forwarded !== undefined) {
      expect(itemEquals(forwarded, literal('@1974-12-25'), modelLess)).toBe(true);
    }
  });

  it('does not change later String operations on the node', () => {
    const before = Object.keys(birthDate);
    expect(itemEquals(birthDate, literal('@1974-12-25'), modelLess)).toBe(true);
    expect(compare(birthDate, literal('@2000'), modelLess)).toBe(-1);
    expect(birthDate.value).toBe('1974-12-25');
    expect(Object.keys(birthDate)).toEqual(before);
    expect(toSystemValue(birthDate)).toBe('1974-12-25');
    expect(itemEquals(birthDate, literal("'1974-12-25'"), modelLess)).toBe(true);
    expect(compare(birthDate, literal("'1974-12-26'"), modelLess)).toBe(-1);
  });

  // Collection functions that use the kernels inherit the convenience (`in`, `contains`, `distinct`).
  it('applies to collections compared with = and ~', () => {
    const dates: Collection = [literal('@1974-12-25'), literal('@T10:00:00')];
    expect(equals([birthDate, t], dates, modelLess)).toBe(true);
    expect(equivalent([t, birthDate], dates, modelLess)).toBe(true);
    expect(equals([birthDate, t], dates, withModel)).toBe(false);
  });

  it('is symmetric for every date, date/time and time text', () => {
    const texts = fc.oneof(
      fc
        .record({
          year: fc.integer({ min: 1, max: 9999 }),
          month: fc.integer({ min: 1, max: 12 }),
          day: fc.integer({ min: 1, max: 28 }),
          precision: fc.constantFrom(1, 2, 3),
        })
        .map(({ year, month, day, precision }) =>
          [String(year).padStart(4, '0'), pad(month), pad(day)].slice(0, precision).join('-'),
        ),
      fc
        .record({ hour: fc.integer({ min: 0, max: 23 }), minute: fc.integer({ min: 0, max: 59 }) })
        .map(({ hour, minute }) => `${pad(hour)}:${pad(minute)}`),
      fc
        .record({
          day: fc.integer({ min: 1, max: 28 }),
          hour: fc.integer({ min: 0, max: 23 }),
          offset: fc.constantFrom('', 'Z', '+05:30', '-03:00'),
        })
        .map(({ day, hour, offset }) => `2012-04-${pad(day)}T${pad(hour)}:00:00${offset}`),
    );
    const others = fc.constantFrom(
      '@2012',
      '@2012-04',
      '@2012-04-15',
      '@2012-04-15T10:00',
      '@2012-04-15T10:00:00Z',
      '@T10:00',
      '@T10:00:00',
    );
    fc.assert(
      fc.property(texts, others, (text, otherText) => {
        const node = input(text);
        const other = literal(otherText);
        expect(itemEquals(node, other, modelLess)).toBe(itemEquals(other, node, modelLess));
        expect(itemEquivalent(node, other, modelLess)).toBe(itemEquivalent(other, node, modelLess));
        const parsed = operandValue(node, other, undefined);
        if (parsed !== undefined && isTemporal(parsed)) {
          expect(compare(other, node, modelLess)).toBe(negate(compare(node, other, modelLess)));
        } else {
          expectTypeMismatch(() => compare(node, other, modelLess));
          expectTypeMismatch(() => compare(other, node, modelLess));
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('operandValue', () => {
  it('returns the System value of an item', () => {
    expect(operandValue(input('abc'), literal("'abc'"), undefined)).toBe('abc');
    expect(operandValue(literal('1.5'), birthDate, undefined)).toEqual(literal('1.5'));
    expect(operandValue(new ModelNode({ value: 3, name: 'n' }), 1, undefined)).toBe(3);
  });

  it('parses eligible text only against a date/time value', () => {
    expect(operandValue(birthDate, literal('@2000'), undefined)).toBeInstanceOf(DateValue);
    expect(operandValue(input('1974-12-25T10:00'), literal('@2000'), undefined)).toBeInstanceOf(
      DateTimeValue,
    );
    expect(operandValue(input('1974-12-25T10:00'), literal('@T10'), undefined)).toBe(
      '1974-12-25T10:00',
    );
    expect(operandValue(t, literal('@T10'), undefined)).toBeInstanceOf(TimeValue);
    expect(operandValue(t, literal("'10:00:00'"), undefined)).toBe('10:00:00');
    expect(operandValue(birthDate, input('2000-01-01'), undefined)).toBe('1974-12-25');
    expect(operandValue(birthDate, literal('@2000'), stubModel)).toBe('1974-12-25');
  });
});

/** The order with the operands swapped, without producing `-0`. */
function negate(order: Ordering | undefined): Ordering | undefined {
  return order === undefined || order === 0 ? order : order === 1 ? -1 : 1;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
