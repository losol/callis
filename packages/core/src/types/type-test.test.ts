import { describe, expect, it } from 'vitest';
import { stubModel, stubType } from '../../test/support/stub-model.ts';
import type { ModelTypeInfo } from '../model/model-provider.ts';
import { findSystemType, SYSTEM_TYPES, type SystemType } from './system-types.ts';
import { isOfType, isSameType, matchesOfType } from './type-test.ts';

type Type = SystemType | ModelTypeInfo;

/** `System.X` is a System type, anything else a type of the stub model. */
function type(name: string): Type {
  if (!name.startsWith('System.')) {
    return stubType(name);
  }
  const systemType = findSystemType(name.slice('System.'.length));
  if (systemType === undefined) {
    throw new Error(`No System type ${name}`);
  }
  return systemType;
}

describe('isSameType', () => {
  it('compares namespace and name, not identity', () => {
    expect(isSameType(SYSTEM_TYPES.String, { namespace: 'System', name: 'String' })).toBe(true);
    expect(isSameType(SYSTEM_TYPES.String, { namespace: 'FHIR', name: 'String' })).toBe(false);
    expect(isSameType(SYSTEM_TYPES.String, SYSTEM_TYPES.Integer)).toBe(false);
  });
});

// https://hl7.org/fhirpath/N1/#is-type-specifier: "the type of the left operand is the type
// specified in the second operand, or a subclass thereof"
describe('isOfType (is, as) with System types', () => {
  it.each<[string, string, boolean]>([
    ['System.Integer', 'System.Integer', true], // testIntegerLiteralIsInteger
    ['System.Boolean', 'System.Boolean', true], // testType5
    ['System.Integer', 'System.Decimal', false], // testIntegerLiteralIsNotDecimal: conversion is not subtyping
    ['System.Decimal', 'System.Quantity', false], // testDecimalLiteralIsNotQuantity
    ['System.String', 'System.Integer', false], // testStringLiteralIsNotInteger
    ['System.Date', 'System.DateTime', false],
    ['System.Integer', 'System.Any', true], // System.Any is the root type (N1 §4.1)
    ['System.Quantity', 'System.Any', true],
    ['System.Any', 'System.Integer', false],
  ])('%s is %s: %s', (actual, target, expected) => {
    expect(isOfType(type(actual), type(target))).toBe(expected);
    expect(isOfType(type(actual), type(target), stubModel)).toBe(expected);
  });
});

describe('isOfType (is, as) with model types', () => {
  it.each<[string, string, boolean]>([
    ['Patient', 'Patient', true], // testType17
    ['Patient', 'DomainResource', true], // inheritance
    ['Patient', 'Resource', true],
    ['Patient', 'Observation', false],
    ['Resource', 'Patient', false],
    ['code', 'code', true], // testFHIRPathIsFunction1
    ['code', 'string', true], // testFHIRPathIsFunction2: FHIR.code derives from FHIR.string
    ['code', 'id', false], // testFHIRPathIsFunction3
    ['Age', 'Quantity', true], // testFHIRPathIsFunction9
    ['Patient.contact', 'BackboneElement', true],
    ['Patient.contact', 'Element', true],
    // FHIR primitives are not System types for `is` (R5 §2.1.9.1.2).
    ['boolean', 'System.Boolean', false], // testType14
    ['string', 'System.String', false],
    ['date', 'System.Date', false],
    ['Quantity', 'System.Quantity', false],
    ['boolean', 'System.Any', true],
    ['Patient', 'System.Any', true],
    // A System type is never a model type.
    ['System.Integer', 'integer', false],
    ['System.Boolean', 'boolean', false],
  ])('%s is %s: %s', (actual, target, expected) => {
    expect(isOfType(type(actual), type(target), stubModel)).toBe(expected);
  });

  it('without a model, a model type only matches itself', () => {
    expect(isOfType(type('Patient'), type('Patient'))).toBe(true);
    expect(isOfType(type('Patient'), type('DomainResource'))).toBe(false);
    expect(isOfType(type('Patient'), type('System.Any'))).toBe(true);
  });
});

// https://hl7.org/fhir/R5/fhirpath.html#types: "ofType() does not have such restrictions"
describe('matchesOfType (ofType)', () => {
  it.each<[string, string, boolean]>([
    ['string', 'string', true],
    ['string', 'System.String', true],
    ['code', 'string', true],
    ['code', 'System.String', true], // derived primitives map too
    ['date', 'System.Date', true], // FHIR.date maps to System.Date in Callis
    ['date', 'System.DateTime', false], // a type filter does not convert
    ['dateTime', 'System.DateTime', true],
    ['boolean', 'System.Boolean', true],
    ['boolean', 'System.String', false],
    ['Quantity', 'System.Quantity', true], // type level; the UCUM check is per value
    ['Age', 'System.Quantity', true],
    ['HumanName', 'System.String', false], // no System mapping
    ['Patient', 'Patient', true], // testType20
    ['Patient', 'DomainResource', true],
    ['Patient', 'Observation', false],
    ['System.Integer', 'System.Integer', true],
    ['System.Integer', 'System.Decimal', false],
    ['System.String', 'string', false],
  ])('%s matches ofType(%s): %s', (actual, target, expected) => {
    expect(matchesOfType(type(actual), type(target), stubModel)).toBe(expected);
  });

  it('without a model, behaves like isOfType', () => {
    expect(matchesOfType(type('string'), type('System.String'))).toBe(false);
    expect(matchesOfType(type('System.String'), type('System.String'))).toBe(true);
  });
});
