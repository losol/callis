import { describe, expect, it } from 'vitest';
import { JsonNumber, parseJson } from '../model/lossless-json.ts';
import { ModelNode } from '../model/model-node.ts';
import { parseTemporalLiteral } from '../values/datetime/parse.ts';
import { Decimal, MAX_DECIMAL_DIGITS } from '../values/decimal/decimal.ts';
import { Quantity } from '../values/quantity/quantity.ts';
import { toOutput, toPlainValue } from './output.ts';

function temporal(literal: string) {
  const value = parseTemporalLiteral(literal);
  if (value === undefined) {
    throw new Error(`invalid test literal ${literal}`);
  }
  return value;
}

// https://github.com/losol/callis/blob/main/docs/tasks/T0025-public-api-release.md#public-api-sketch
describe('plain output', () => {
  it('keeps Booleans, Strings and Integers', () => {
    expect(toOutput([true, 'a', 1])).toEqual([true, 'a', 1]);
  });

  // ADR-0012: Decimal as a number by default.
  it('gives Decimals as numbers, or as exact text with decimalOutput: string', () => {
    const decimal = Decimal.parse('1.50');
    const items = decimal === undefined ? [] : [decimal];
    expect(toOutput(items)).toEqual([1.5]);
    expect(toOutput(items, { decimalOutput: 'string' })).toEqual(['1.50']);
  });

  it('gives dates and times as FHIR text without @', () => {
    expect(
      toOutput([temporal('@2015-02-04'), temporal('@2015-02-04T14:34:28Z'), temporal('@T14:34')]),
    ).toEqual(['2015-02-04', '2015-02-04T14:34:28Z', '14:34']);
  });

  it('gives a UCUM quantity with its system and code, a calendar duration without', () => {
    expect(toPlainValue(new Quantity(Decimal.ONE, 'mg'))).toEqual({
      value: 1,
      unit: 'mg',
      system: 'http://unitsofmeasure.org',
      code: 'mg',
    });
    expect(toPlainValue(new Quantity(Decimal.ONE, 'days'), 'string')).toEqual({
      value: '1',
      unit: 'day',
    });
  });

  it('gives input nodes as their JSON, and an extension-only primitive as its _name object', () => {
    const json = { a: 1 };
    const extensionOnly = { extension: [] };
    expect(
      toOutput([
        new ModelNode({ value: json, name: 'x' }),
        new ModelNode({ value: undefined, name: 'x', primitiveElement: extensionOnly }),
        new ModelNode({ value: undefined, name: 'x' }),
      ]),
    ).toEqual([json, extensionOnly]);
  });
});

// docs/tasks/T0018-model-aware-evaluation.md#lossless-decimals-in-json-input
describe('plain output of lossless JSON numbers', () => {
  it('gives an Integer as a number and a Decimal as a number or exact text', () => {
    const node = (text: string) => new ModelNode({ value: new JsonNumber(text), name: 'n' });
    expect(toOutput([node('185'), node('1.50'), node('9.5e2')])).toEqual([185, 1.5, 950]);
    // An Integer is always a number; only Decimals have an exact text form.
    expect(
      toOutput([node('185'), node('1.50'), node('9.5e2')], { decimalOutput: 'string' }),
    ).toEqual([185, '1.50', '950']);
    expect(toPlainValue(node(`1e${MAX_DECIMAL_DIGITS + 1}`))).toBe(Number.POSITIVE_INFINITY);
  });

  it('gives an object with lossless numbers as it is', () => {
    const json = parseJson('{"value": 1.50}');
    expect(toPlainValue(new ModelNode({ value: json, name: 'q' }))).toBe(json);
    expect(JSON.stringify(toOutput([new ModelNode({ value: json, name: 'q' })]))).toBe(
      '[{"value":1.5}]',
    );
  });
});

describe('typed output', () => {
  it('gives the items themselves, in a new array', () => {
    const node = new ModelNode({ value: 'a', name: 'x' });
    const items = Object.freeze([node, Decimal.ONE]);
    const output = toOutput(items, { output: 'typed' });
    expect(output).toEqual([node, Decimal.ONE]);
    expect(output).not.toBe(items);
    expect(output[0]).toBe(node);
  });
});

describe('output options', () => {
  it.each([{ output: 'json' }, { decimalOutput: 'bigint' }])(
    'raises eval/invalid-argument for %j',
    (options) => {
      expect(() => toOutput([], options as never)).toThrow(
        expect.objectContaining({ code: 'eval/invalid-argument' }),
      );
    },
  );
});
