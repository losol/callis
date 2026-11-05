import { describe, expect, it } from 'vitest';
import { parse } from '../src/parser/parser.ts';
import {
  CALENDAR_UNITS,
  isCalendarUnit,
  normalizeCalendarUnit,
} from '../src/values/quantity/calendar-units.ts';

// The parser may not import values/ (architecture.md, module dependency rules), so it keeps its own
// list of the calendar keywords a quantity literal may use. The two lists must agree: every keyword
// the parser accepts must be a calendar unit for the Quantity module, and the reverse, or the
// compiler (T0008) gets quantity literals it cannot evaluate. Compare #53 for the date/time side.
// https://hl7.org/fhirpath/N1/grammar.html (quantity, dateTimePrecision, pluralDateTimePrecision)
// https://hl7.org/fhirpath/STU3/#time-valued-quantities
describe('calendar keywords in quantity literals', () => {
  const keywords = CALENDAR_UNITS.flatMap((keyword) => [keyword, `${keyword}s`]);

  it.each(keywords)('parses 2 %s as a quantity with a calendar unit', (keyword) => {
    expect(parse(`2 ${keyword}`)).toMatchObject({
      kind: 'Literal',
      type: 'Quantity',
      number: '2',
      unit: keyword,
    });
    expect(isCalendarUnit(keyword)).toBe(true);
    expect(CALENDAR_UNITS).toContain(normalizeCalendarUnit(keyword));
  });

  // Keywords are case-sensitive, and abbreviations are UCUM codes, which need quotes ('ms').
  it.each(['decade', 'fortnight', 'Year', 'ms', 'secs'])(
    'rejects 2 %s, which is not a calendar keyword',
    (word) => {
      expect(isCalendarUnit(word)).toBe(false);
      expect(() => parse(`2 ${word}`)).toThrowError(
        expect.objectContaining({ code: 'syntax/unexpected-token' }),
      );
    },
  );
});
