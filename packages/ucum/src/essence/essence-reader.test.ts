import { describe, expect, it } from 'vitest';
import { readEssence } from './essence-reader.ts';

// A synthetic document in the layout of ucum-essence.xml; the units are invented.
const DOCUMENT = `<?xml version="1.0" encoding="ascii"?>
<root xmlns="http://unitsofmeasure.org/ucum-essence" version="9.9" revision="N/A"
      revision-date="2000-01-02">
   <prefix Code="k" CODE="K">
      <name>kilo</name>
      <value value="1e3">1 &#215; 10<sup>3</sup></value>
   </prefix>
   <base-unit Code="m" CODE="M" dim="L">
      <name>meter</name>
   </base-unit>
   <unit Code="xyz" CODE="XYZ" isMetric="yes" class="test">
      <name>test unit</name>
      <value Unit="m" UNIT="M" value="2">2</value>
   </unit>
   <unit Code="[warm]" CODE="[WARM]" isMetric="no" isSpecial="yes" class="test">
      <value Unit="warm(1 m)" UNIT="WARM(1 M)"><function name="warm" value="1" Unit="m"/></value>
   </unit>
   <unit Code="[arb]" CODE="[ARB]" isMetric="no" isArbitrary="yes" class="test">
      <value Unit="1" UNIT="1" value="1">1</value>
   </unit>
</root>
`;

describe('readEssence', () => {
  it('reads version, prefixes, base units and units in document order', () => {
    expect(readEssence(DOCUMENT)).toEqual({
      version: '9.9',
      revisionDate: '2000-01-02',
      prefixes: [{ code: 'k', value: '1e3' }],
      baseUnits: [{ code: 'm', dimension: 'L' }],
      units: [
        {
          code: 'xyz',
          isMetric: true,
          isSpecial: false,
          isArbitrary: false,
          unit: 'm',
          value: '2',
          function: undefined,
        },
        {
          code: '[warm]',
          isMetric: false,
          isSpecial: true,
          isArbitrary: false,
          unit: 'warm(1 m)',
          value: undefined,
          function: { name: 'warm', value: '1', unit: 'm' },
        },
        {
          code: '[arb]',
          isMetric: false,
          isSpecial: false,
          isArbitrary: true,
          unit: '1',
          value: '1',
          function: undefined,
        },
      ],
    });
  });

  it.each([
    ['malformed XML', '<root>'],
    ['another root element', '<ucum/>'],
    ['a prefix without a code', '<root><prefix><value value="1e3"/></prefix></root>'],
    ['a prefix without a value', '<root><prefix Code="k"/></root>'],
    ['a base unit without a dimension', '<root><base-unit Code="m"/></root>'],
    ['a unit without a value element', '<root><unit Code="u"/></root>'],
    ['a unit without a value', '<root><unit Code="u"><value Unit="m"/></unit></root>'],
    [
      'a special unit without a function',
      '<root><unit Code="u" isSpecial="yes"><value Unit="m" value="1"/></unit></root>',
    ],
    [
      'a function on a unit that is not special',
      '<root><unit Code="u"><value Unit="f(1 m)"><function name="f" value="1" Unit="m"/></value></unit></root>',
    ],
    [
      'an incomplete function',
      '<root><unit Code="u" isSpecial="yes"><value Unit="f(1 m)"><function name="f"/></value></unit></root>',
    ],
  ])('rejects %s', (_, xml) => {
    expect(readEssence(xml)).toBeUndefined();
  });
});
