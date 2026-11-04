import { describe, expect, it } from 'vitest';
import { parseSuite } from './parse-suite.ts';
import { allTests } from './suite.ts';

// The test-file format is fixtures/r5/testSchema.xsd. The R5 file uses the
// http://hl7.org/fhirpath/tests namespace; the R4 copy has none.
const XML = `<?xml version="1.0" encoding="utf-8" ?>
<tests name="FHIRPathTestSuite" xmlns="http://hl7.org/fhirpath/tests">
<!--
  <test name="commentedOut"><expression>1</expression></test>
-->
  <group name="g1" description="first">
    <notes>ignored</notes>
    <test name="basic" testing="paths" inputfile="patient-example.xml" description="d">
      <expression>
        Patient.name.given
      </expression>
      <output type="string">Peter</output>
      <output type="string"> spaced </output>
    </test>
    <test name="escapes"><expression invalid="semantic">1 &amp; 2 &lt; 3</expression></test>
  </group>
  <group name="g2" mode="custom">
    <test name="inherits"><expression>x</expression><output>10.0</output></test>
    <test name="own" mode="element" ordered="false" predicate="true" skipStaticCheck='true'><expression>x</expression></test>
    <test name="exprMode"><expression mode="strict" invalid="execution">x</expression></test>
    <test name="ctx" context="Observation.effective" contextType="Period|Timing" version="2.1.0"><expression>$this</expression></test>
    <test name="orderedR5" ordered="true"><expression>x</expression></test>
    <test name="orderedR4" checkOrderedFunctions="true"><expression>x</expression></test>
    <test name="basic"><expression>again</expression></test>
  </group>
</tests>
`;

describe('parseSuite', () => {
  const suite = parseSuite(XML, 'r5', 'tests.xml');
  const tests = allTests(suite);
  const byId = (id: string) => {
    const test = tests.find((t) => t.id === id);
    if (test === undefined) {
      throw new Error(`no test ${id}`);
    }
    return test;
  };

  it('reads groups and tests in document order, ignoring comments', () => {
    expect(suite.groups.map((g) => [g.name, g.description, g.mode])).toEqual([
      ['g1', 'first', undefined],
      ['g2', undefined, 'custom'],
    ]);
    expect(tests.map((t) => t.id)).toEqual([
      'basic',
      'escapes',
      'inherits',
      'own',
      'exprMode',
      'ctx',
      'orderedR5',
      'orderedR4',
      'basic#2',
    ]);
  });

  it('reads a test with its outputs, keeping output text exactly', () => {
    expect(byId('basic')).toMatchObject({
      name: 'basic',
      group: 'g1',
      line: 8,
      description: 'd',
      testing: 'paths',
      inputFile: 'patient-example.xml',
      expression: 'Patient.name.given',
      invalid: undefined,
      outputs: [
        { type: 'string', text: 'Peter' },
        { type: 'string', text: ' spaced ' },
      ],
      predicate: false,
      ordered: undefined,
      checkOrderedFunctions: false,
    });
  });

  it('decodes entities and reads invalid', () => {
    expect(byId('escapes')).toMatchObject({ expression: '1 & 2 < 3', invalid: 'semantic' });
  });

  it('keeps untyped outputs (R4)', () => {
    expect(byId('inherits').outputs).toEqual([{ type: undefined, text: '10.0' }]);
  });

  it('takes the mode from the test, then the expression, then the group', () => {
    expect(byId('inherits').mode).toBe('custom');
    expect(byId('own').mode).toBe('element');
    expect(byId('exprMode')).toMatchObject({ mode: 'strict', invalid: 'execution' });
  });

  it('reads Boolean attributes, including single-quoted ones', () => {
    expect(byId('own')).toMatchObject({ ordered: false, predicate: true, skipStaticCheck: true });
  });

  it('splits contextType and reads version', () => {
    expect(byId('ctx')).toMatchObject({
      context: 'Observation.effective',
      contextTypes: ['Period', 'Timing'],
      version: '2.1.0',
    });
  });

  it('treats ordered="true" (R5) like checkOrderedFunctions="true" (R4)', () => {
    expect(byId('orderedR5')).toMatchObject({ ordered: true, checkOrderedFunctions: true });
    expect(byId('orderedR4')).toMatchObject({ ordered: undefined, checkOrderedFunctions: true });
  });

  it('makes duplicate names unique with a counter suffix', () => {
    expect(byId('basic#2')).toMatchObject({ name: 'basic', expression: 'again' });
  });

  it('records the line of each test', () => {
    expect(tests.map((t) => t.line)).toEqual([8, 15, 18, 19, 20, 21, 22, 23, 24]);
  });

  it.each([
    ['an unknown output type', '<output type="uri">x</output>', 'unknown output type "uri"'],
    ['an unknown invalid value', '', 'unknown invalid="maybe"'],
  ])('rejects %s', (_, output, message) => {
    const invalid = output === '' ? ' invalid="maybe"' : '';
    const xml = `<tests><group name="g"><test name="t"><expression${invalid}>x</expression>${output}</test></group></tests>`;
    expect(() => parseSuite(xml, 'r4', 'bad.xml')).toThrow(message);
  });

  it('rejects a test without an expression', () => {
    const xml = '<tests><group name="g"><test name="t"></test></group></tests>';
    expect(() => parseSuite(xml, 'r4', 'bad.xml')).toThrow('bad.xml: test t: missing <expression>');
  });
});
