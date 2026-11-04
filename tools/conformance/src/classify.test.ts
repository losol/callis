import { describe, expect, it } from 'vitest';
import { classifyTest, findStuFeature } from './classify.ts';
import { makeTest } from './test-helpers.ts';

describe('classifyTest', () => {
  it('puts N1 normative features in phase 1', () => {
    expect(classifyTest(makeTest({ expression: "Patient.name.where(use = 'official')" }))).toEqual({
      phase: 'phase1',
      reason: undefined,
      task: undefined,
    });
  });

  // ADR-0001: STU features are phase 2.
  it.each([
    ['(1 | 2).sort()', 'sort() (T0027)', 'T0027'],
    ["'a,b'.split(',')", 'split() (T0029)', 'T0029'],
    ['1.587.lowBoundary(6)', 'lowBoundary() (T0030)', 'T0030'],
    ["1.type().name = 'Integer'", 'type() (T0031)', 'T0031'],
    ['(1 | 2).aggregate($this + $total, 0)', 'aggregate() (T0026)', 'T0026'],
    ['$total', '$total (T0026)', 'T0026'],
    ['1L + 1', 'Long literal (T0028)', 'T0028'],
    ["%terminologies.expand('x')", '%terminologies (T0032)', 'T0032'],
    // N1 §8.6 (https://hl7.org/fhirpath/N1/#identifiers): a delimited identifier is the same name.
    ['(2 | 1).`sort`()', 'sort() (T0027)', 'T0027'],
    ['(2 | 1).`\\u0073ort`()', 'sort() (T0027)', 'T0027'],
    ["%`terminologies`.expand('x')", '%terminologies (T0032)', 'T0032'],
  ])('puts %s in STU', (expression, reason, task) => {
    expect(classifyTest(makeTest({ expression }))).toEqual({ phase: 'stu', reason, task });
  });

  it('marks tests for a newer FHIRPath version as STU', () => {
    expect(classifyTest(makeTest({ version: '2.1.0' }))).toEqual({
      phase: 'stu',
      reason: 'needs FHIRPath 2.1.0',
      task: undefined,
    });
    expect(classifyTest(makeTest({ version: '2.0.0' })).phase).toBe('phase1');
  });

  it('marks STU groups as STU even without an STU function', () => {
    expect(classifyTest(makeTest({ group: 'testAggregate', expression: '1' }))).toEqual({
      phase: 'stu',
      reason: 'STU group testAggregate (T0026)',
      task: 'T0026',
    });
  });

  it('marks mode="tx" as STU', () => {
    expect(classifyTest(makeTest({ mode: 'tx' })).task).toBe('T0032');
  });

  it.each([
    [{ mode: 'cda' }, 'CDA logical model (mode="cda")'],
    [{ mode: 'custom' }, 'engine-specific extension functions (mode="custom")'],
    [
      { group: 'documentFunctions', mode: 'element' },
      'HL7 Java engine document functions (out of scope)',
    ],
    [{ mode: 'quantum' }, 'unknown mode "quantum"'],
  ])('marks %o as unsupported', (overrides, reason) => {
    expect(classifyTest(makeTest(overrides))).toEqual({
      phase: 'unsupported',
      reason,
      task: undefined,
    });
  });

  it.each(['strict', 'lenient/polymorphics', 'element', 'html', 'semantic'])(
    'keeps mode="%s" in phase 1',
    (mode) => {
      expect(classifyTest(makeTest({ mode })).phase).toBe('phase1');
    },
  );
});

describe('findStuFeature', () => {
  it.each([
    "'sort(' + 'x'",
    'Patient.`sort`',
    '`sort me`(1)',
    '// sort()\n1',
    '/* split() */ 1',
    'Patient.ofType(Patient)',
    'Patient.type',
    "5 'L'",
    '@2014-01-01T10:30',
  ])('ignores %j', (expression) => {
    expect(findStuFeature(expression)).toBeUndefined();
  });
});
