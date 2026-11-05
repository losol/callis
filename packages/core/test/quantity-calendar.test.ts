import { describe, expect, it } from 'vitest';
import { addCalendar } from '../src/values/datetime/arithmetic.ts';
import { DateTimeValue } from '../src/values/datetime/datetime.ts';
import { Decimal } from '../src/values/decimal/decimal.ts';
import { CALENDAR_UCUM, CALENDAR_UNITS } from '../src/values/quantity/calendar-units.ts';
import { fromFhirQuantity } from '../src/values/quantity/fhir-quantity.ts';
import {
  compareQuantity,
  quantityEquals,
  quantityEquivalent,
} from '../src/values/quantity/operations.ts';
import { Quantity } from '../src/values/quantity/quantity.ts';

// #53: independent tables must agree without violating value-module dependencies.
// https://hl7.org/fhirpath/STU3/#time-valued-quantities
// https://hl7.org/fhirpath/STU3/#datetime-arithmetic
describe('quantity and datetime calendar consistency', () => {
  const start = DateTimeValue.create({
    year: 2020,
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  it.each(CALENDAR_UNITS)(
    'keeps %s and its plural consistent with datetime arithmetic',
    (keyword) => {
      const calendar = new Quantity(Decimal.ONE, keyword);
      const plural = new Quantity(Decimal.ONE, `${keyword}s`);
      const code = CALENDAR_UCUM[keyword];
      const definite = new Quantity(Decimal.ONE, code);
      expect(addCalendar(start, plural.value, plural.unit)).toEqual(
        addCalendar(start, calendar.value, calendar.unit),
      );
      expect(addCalendar(start, Decimal.ONE, `${keyword}s`)).toEqual(
        addCalendar(start, Decimal.ONE, keyword),
      );
      expect(quantityEquals(plural, calendar)).toBe(true);
      expect(quantityEquivalent(calendar, definite)).toBe(true);
      if (keyword === 'year' || keyword === 'month') {
        expect(quantityEquals(calendar, definite)).toBeUndefined();
        expect(compareQuantity(calendar, definite)).toBeUndefined();
        expect(() => addCalendar(start, Decimal.ONE, code)).toThrowError(
          expect.objectContaining({ code: 'eval/invalid-calendar-unit' }),
        );
        const mapped = fromFhirQuantity({ system: 'http://unitsofmeasure.org', code, value: 1 });
        expect(mapped?.unit).toBe(keyword);
        if (mapped !== undefined)
          expect(addCalendar(start, mapped.value, mapped.unit)).toEqual(
            addCalendar(start, Decimal.ONE, keyword),
          );
      } else {
        expect(quantityEquals(calendar, definite)).toBe(true);
        expect(addCalendar(start, definite.value, definite.unit)).toEqual(
          addCalendar(start, calendar.value, calendar.unit),
        );
      }
    },
  );
});
