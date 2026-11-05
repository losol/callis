import { describe, expect, it } from 'vitest';
import type { ModelProvider } from '../../../packages/core/src/model/model-provider.ts';
import { r4 } from '../../../packages/fhir-r4/src/index.ts';
import { r5 } from '../../../packages/fhir-r5/src/index.ts';
import { convertFhirXml, FhirXmlError } from './fhir-xml.ts';
import { NumberLexeme, parseJsonKeepingNumbers, stringifyJson } from './json-text.ts';

const FHIR = 'xmlns="http://hl7.org/fhir"';
const XHTML = 'xmlns="http://www.w3.org/1999/xhtml"';

/** Converts and writes JSON text. */
function toJson(xml: string, model: ModelProvider = r4): string {
  return stringifyJson(convertFhirXml(xml, model));
}

/** Converts and reads the JSON back, with numbers as {@link NumberLexeme}. */
function convert(xml: string, model: ModelProvider = r4): unknown {
  return parseJsonKeepingNumbers(toJson(xml, model));
}

function errorOf(
  xml: string,
  model: ModelProvider = r4,
): { code: string; path: string } | undefined {
  try {
    convertFhirXml(xml, model);
  } catch (error) {
    if (error instanceof FhirXmlError) return { code: error.code, path: error.path };
    throw error;
  }
  return undefined;
}

describe('convertFhirXml', () => {
  // https://hl7.org/fhir/R4/json.html#resources
  it('writes resourceType first, then the elements in model order', () => {
    const json = toJson(
      `<Patient ${FHIR}><id value="p1"/><active value="true"/><gender value="male"/><birthDate value="1974-12-25"/></Patient>`,
    );
    expect(json).toBe(
      '{\n  "resourceType": "Patient",\n  "id": "p1",\n  "active": true,\n  "gender": "male",\n  "birthDate": "1974-12-25"\n}\n',
    );
  });

  it('uses the model order even when the XML is out of order', () => {
    const result = convert(`<Patient ${FHIR}><gender value="male"/><id value="p1"/></Patient>`);
    expect(Object.keys(result as object)).toEqual(['resourceType', 'id', 'gender']);
  });

  // https://hl7.org/fhir/R4/json.html#arrays
  it('writes repeating elements as arrays, even with one item, and others as single values', () => {
    const result = convert(
      `<Patient ${FHIR}><name><family value="Chalmers"/><given value="Peter"/></name><gender value="male"/></Patient>`,
    );
    expect(result).toEqual({
      resourceType: 'Patient',
      name: [{ family: 'Chalmers', given: ['Peter'] }],
      gender: 'male',
    });
  });

  // https://hl7.org/fhir/R4/json.html#primitive
  it('keeps decimal and integer values as written', () => {
    const json = toJson(
      `<Parameters ${FHIR}>` +
        '<parameter><name value="a"/><valueDecimal value="1.50"/></parameter>' +
        '<parameter><name value="b"/><valueDecimal value="9.5e2"/></parameter>' +
        '<parameter><name value="c"/><valueDecimal value="-1.5E-3"/></parameter>' +
        '<parameter><name value="d"/><valueDecimal value="0.00000000000000000000000000001"/></parameter>' +
        '<parameter><name value="e"/><valueInteger value="-2147483648"/></parameter>' +
        '<parameter><name value="f"/><valueUnsignedInt value="0"/></parameter>' +
        '<parameter><name value="g"/><valuePositiveInt value="12345678901234567890"/></parameter>' +
        '</Parameters>',
    );
    for (const lexeme of [
      '1.50',
      '9.5e2',
      '-1.5E-3',
      '0.00000000000000000000000000001',
      '-2147483648',
      '0',
    ]) {
      expect(json).toContain(`: ${lexeme}\n`);
    }
    // Not range-checked: the value is written as it is, not rounded through a JavaScript number.
    expect(json).toContain('"valuePositiveInt": 12345678901234567890\n');
  });

  // https://hl7.org/fhir/R5/json.html#primitive: integer64 is a JSON string.
  it('writes R5 integer64 as a string', () => {
    const result = convert(
      `<Parameters ${FHIR}><parameter><name value="n"/><valueInteger64 value="9007199254740993"/></parameter></Parameters>`,
      r5,
    );
    expect(result).toEqual({
      resourceType: 'Parameters',
      parameter: [{ name: 'n', valueInteger64: '9007199254740993' }],
    });
  });

  it('writes the type into the name of a choice element', () => {
    const result = convert(
      `<Observation ${FHIR}><status value="final"/><code><text value="x"/></code>` +
        '<valueQuantity><value value="185"/><unit value="lbs"/></valueQuantity></Observation>',
    );
    expect(result).toMatchObject({
      valueQuantity: { value: new NumberLexeme('185'), unit: 'lbs' },
    });
  });

  // https://hl7.org/fhir/R4/json.html#primitive
  it('writes the id and extensions of a primitive to _name', () => {
    const result = convert(
      `<Patient ${FHIR}><birthDate id="b" value="1974-12-25">` +
        '<extension url="http://hl7.org/fhir/StructureDefinition/patient-birthTime">' +
        '<valueDateTime value="1974-12-25T14:35:45-05:00"/></extension></birthDate></Patient>',
    );
    expect(result).toEqual({
      resourceType: 'Patient',
      birthDate: '1974-12-25',
      _birthDate: {
        id: 'b',
        extension: [
          {
            url: 'http://hl7.org/fhir/StructureDefinition/patient-birthTime',
            valueDateTime: '1974-12-25T14:35:45-05:00',
          },
        ],
      },
    });
  });

  it('aligns a repeating primitive and its extras with nulls', () => {
    const result = convert(
      `<Patient ${FHIR}><name><given value="a"/>` +
        '<given><extension url="urn:x"><valueString value="no value"/></extension></given>' +
        '<given id="g3" value="c"/></name></Patient>',
    );
    expect(result).toEqual({
      resourceType: 'Patient',
      name: [
        {
          given: ['a', null, 'c'],
          _given: [null, { extension: [{ url: 'urn:x', valueString: 'no value' }] }, { id: 'g3' }],
        },
      ],
    });
  });

  it('leaves out the value array when no item has a value', () => {
    const result = convert(
      `<Patient ${FHIR}><name><given id="g1"/><given id="g2"/></name></Patient>`,
    );
    expect(result).toEqual({
      resourceType: 'Patient',
      name: [{ _given: [{ id: 'g1' }, { id: 'g2' }] }],
    });
  });

  // https://hl7.org/fhir/R4/xml.html#xml: Element.id and Extension.url are attributes.
  it('reads Element.id and Extension.url from attributes', () => {
    const result = convert(
      `<Patient ${FHIR}><extension url="urn:e" id="e1"><valueBoolean value="false"/></extension>` +
        '<name id="n1"><family value="X"/></name></Patient>',
    );
    expect(result).toEqual({
      resourceType: 'Patient',
      extension: [{ id: 'e1', url: 'urn:e', valueBoolean: false }],
      name: [{ id: 'n1', family: 'X' }],
    });
  });

  // https://hl7.org/fhir/R4/narrative.html#xhtml
  it('copies the narrative div as written, with its references and comments', () => {
    const div = `<div ${XHTML}>\r\n\t<p class="x">Peter (&quot;Jim&quot;) &#39;a&#39; <!-- note --><br/></p>\r\n</div>`;
    const result = convert(
      `<Patient ${FHIR}><text><status value="generated"/>${div}</text></Patient>`,
    );
    expect(result).toEqual({
      resourceType: 'Patient',
      text: { status: 'generated', div: div.replaceAll('\r\n', '\n') },
    });
  });

  // https://hl7.org/fhir/R4/references.html#contained
  it('writes contained and nested resources without their wrapper', () => {
    const result = convert(
      `<Bundle ${FHIR}><type value="collection"/><entry><resource>` +
        `<Patient><id value="p"/><contained><Organization><id value="o"/></Organization></contained></Patient>` +
        '</resource></entry></Bundle>',
    );
    expect(result).toEqual({
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'p',
            contained: [{ resourceType: 'Organization', id: 'o' }],
          },
        },
      ],
    });
  });

  it('accepts FHIR elements written with a prefix, and xsi attributes on the root', () => {
    const result = convert(
      '<f:Patient xmlns:f="http://hl7.org/fhir" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
        'xsi:schemaLocation="http://hl7.org/fhir fhir-single.xsd"><!-- dropped --><f:active value="false"/></f:Patient>',
    );
    expect(result).toEqual({ resourceType: 'Patient', active: false });
  });

  it('uses the model of the FHIR version', () => {
    // Observation.triggeredBy is new in R5.
    const xml =
      `<Observation ${FHIR}><triggeredBy><observation><reference value="Observation/1"/></observation>` +
      '<type value="reflex"/></triggeredBy><status value="final"/><code><text value="x"/></code></Observation>';
    expect(convert(xml, r5)).toEqual({
      resourceType: 'Observation',
      triggeredBy: [{ observation: { reference: 'Observation/1' }, type: 'reflex' }],
      status: 'final',
      code: { text: 'x' },
    });
    expect(errorOf(xml, r4)?.code).toBe('fhir-xml/unknown-element');
  });

  it.each([
    ['a root outside the FHIR namespace', '<Patient/>', 'fhir-xml/namespace'],
    ['an unknown resource type', `<Patients ${FHIR}/>`, 'fhir-xml/unknown-resource'],
    ['an abstract resource type', `<DomainResource ${FHIR}/>`, 'fhir-xml/unknown-resource'],
    ['a data type as the root', `<HumanName ${FHIR}/>`, 'fhir-xml/unknown-resource'],
    [
      'an unknown element',
      `<Patient ${FHIR}><nickname value="x"/></Patient>`,
      'fhir-xml/unknown-element',
    ],
    [
      'a choice type the element does not allow',
      `<Patient ${FHIR}><deceasedString value="x"/></Patient>`,
      'fhir-xml/unknown-element',
    ],
    [
      'a choice element written as two types',
      `<Patient ${FHIR}><deceasedBoolean value="true"/><deceasedDateTime value="2015"/></Patient>`,
      'fhir-xml/mixed-choice',
    ],
    [
      'a repeated singleton',
      `<Patient ${FHIR}><gender value="male"/><gender value="female"/></Patient>`,
      'fhir-xml/repeated-element',
    ],
    [
      'text outside XHTML',
      `<Patient ${FHIR}>x<active value="true"/></Patient>`,
      'fhir-xml/unexpected-text',
    ],
    [
      'an unknown attribute',
      `<Patient ${FHIR}><gender value="male" foo="1"/></Patient>`,
      'fhir-xml/unexpected-attribute',
    ],
    ['an id attribute on a resource', `<Patient ${FHIR} id="p"/>`, 'fhir-xml/unexpected-attribute'],
    [
      'a url attribute on a non-extension',
      `<Patient ${FHIR}><name url="x"><family value="X"/></name></Patient>`,
      'fhir-xml/unexpected-attribute',
    ],
    [
      'an element in another namespace',
      `<Patient ${FHIR}><active xmlns="urn:x" value="true"/></Patient>`,
      'fhir-xml/namespace',
    ],
    [
      'a FHIR element in the XHTML namespace',
      `<Patient ${FHIR}><active ${XHTML} value="true"/></Patient>`,
      'fhir-xml/namespace',
    ],
    [
      'a narrative outside the XHTML namespace',
      `<Patient ${FHIR}><text><status value="generated"/><div>x</div></text></Patient>`,
      'fhir-xml/namespace',
    ],
    [
      'a narrative that inherits its namespace',
      `<Patient ${FHIR} xmlns:h="http://www.w3.org/1999/xhtml"><text><status value="generated"/><h:div>x</h:div></text></Patient>`,
      'fhir-xml/invalid-xhtml',
    ],
    [
      'a narrative with prefixed content',
      `<Patient ${FHIR} xmlns:h="http://www.w3.org/1999/xhtml"><text><status value="generated"/><div ${XHTML}><h:p>x</h:p></div></text></Patient>`,
      'fhir-xml/invalid-xhtml',
    ],
    [
      'an invalid boolean',
      `<Patient ${FHIR}><active value="yes"/></Patient>`,
      'fhir-xml/invalid-value',
    ],
    [
      'a decimal with a leading "+"',
      `<Parameters ${FHIR}><parameter><valueDecimal value="+1.0"/></parameter></Parameters>`,
      'fhir-xml/invalid-value',
    ],
    [
      'a decimal without an integer part',
      `<Parameters ${FHIR}><parameter><valueDecimal value=".5"/></parameter></Parameters>`,
      'fhir-xml/invalid-value',
    ],
    [
      'an integer with a leading zero',
      `<Parameters ${FHIR}><parameter><valueInteger value="01"/></parameter></Parameters>`,
      'fhir-xml/invalid-value',
    ],
    [
      'an integer with a leading "+"',
      `<Parameters ${FHIR}><parameter><valueInteger value="+5"/></parameter></Parameters>`,
      'fhir-xml/invalid-value',
    ],
    ['an empty value', `<Patient ${FHIR}><gender value=""/></Patient>`, 'fhir-xml/invalid-value'],
    [
      'a primitive without value, id or extension',
      `<Patient ${FHIR}><gender/></Patient>`,
      'fhir-xml/empty-element',
    ],
    ['an empty complex element', `<Patient ${FHIR}><name/></Patient>`, 'fhir-xml/empty-element'],
    [
      'a resource wrapper with two resources',
      `<Patient ${FHIR}><contained><Patient/><Patient/></contained></Patient>`,
      'fhir-xml/invalid-resource',
    ],
    [
      'an empty resource wrapper',
      `<Patient ${FHIR}><contained/></Patient>`,
      'fhir-xml/invalid-resource',
    ],
    [
      'a contained data type',
      `<Patient ${FHIR}><contained><HumanName/></contained></Patient>`,
      'fhir-xml/unknown-resource',
    ],
  ])('refuses %s', (_, xml, code) => {
    expect(errorOf(xml)?.code).toBe(code);
  });

  it('says where a problem is', () => {
    const xml = `<Patient ${FHIR}><name><given value="a"/><given value="b"><foo/></given></name><name/></Patient>`;
    expect(errorOf(xml)).toEqual({
      code: 'fhir-xml/unknown-element',
      path: 'Patient.name[0].given[1]',
    });
  });
});
