import { describe, expect, it } from 'vitest';
import { addCalendar, subtractCalendar } from '../src/values/datetime/arithmetic.ts';
import { parseTemporalLiteral } from '../src/values/datetime/parse.ts';
import type { TemporalValue } from '../src/values/datetime/temporal-value.ts';
import { Decimal } from '../src/values/decimal/decimal.ts';

function literal(text: string): TemporalValue {
  const value = parseTemporalLiteral(text);
  if (value === undefined) {
    throw new Error(`Invalid literal in test: ${text}`);
  }
  return value;
}

function decimal(text: string): Decimal {
  const value = Decimal.parse(text);
  if (value === undefined) {
    throw new Error(`Invalid decimal in test: ${text}`);
  }
  return value;
}

// A quantity's Decimal value goes into date/time arithmetic as it is (T0005 module interface).
describe('date/time arithmetic with Decimal amounts', () => {
  it.each([
    ['@1973-12-25', '7.7', 'days', '@1974-01-01'], // testPlusDate2
    ['@1973-12-25T00:00:00.000+10:00', '0.1', 's', '@1973-12-25T00:00:00.100+10:00'], // testPlusDate19
    ['@1973-12-25T00:00:00.000+10:00', '42.53', 'seconds', '@1973-12-25T00:00:42.530+10:00'], // 3.0.0
    ['@2014', '23', 'months', '@2015'], // N1 §6.7
    ['@T23:30:00', '1.0', 'hour', '@T00:30:00'], // 3.0.0
  ])('%s + %s %s = %s', (value, amount, unit, expected) => {
    expect(addCalendar(literal(value), decimal(amount), unit).toLiteral()).toBe(expected);
  });

  it('subtracts a Decimal amount', () => {
    expect(subtractCalendar(literal('@2019-03-01'), decimal('24'), 'months').toLiteral()).toBe(
      '@2017-03-01',
    );
    expect(subtractCalendar(literal('@1974-01-01'), decimal('-7.9'), 'days').toLiteral()).toBe(
      '@1974-01-08',
    );
  });
});
