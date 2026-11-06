import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type CompiledExpression,
  type CompileOptions,
  compile,
  Decimal,
  type EvaluateOptions,
  evaluate,
  FhirPathError,
  FhirPathEvaluationError,
  FhirPathSemanticError,
  FhirPathSyntaxError,
  type ModelProvider,
  type PlainQuantity,
  type SourceSpan,
  type UnitSystem,
} from '../src/index.ts';

// https://hl7.org/fhirpath/N1/#navigation-model
// https://hl7.org/fhirpath/N1/#null-and-empty
// https://hl7.org/fhirpath/N1/#environment-variables
describe('public synchronous model-less API', () => {
  it('navigates own JSON properties, flattens arrays, and hides provenance', () => {
    const name = { given: ['Ada', 'Mina'] };
    const patient = { resourceType: 'Patient', name: [name], active: true };
    expect(evaluate(patient, 'Patient.name.given')).toEqual(['Ada', 'Mina']);
    expect(evaluate(patient, 'name')[0]).toBe(name);
    expect(evaluate(patient, 'active')).toEqual([true]);
    expect(evaluate(patient, 'missing')).toEqual([]);
    expect(evaluate(null, '$this')).toEqual([]);
    expect(evaluate({}, 'constructor')).toEqual([]);
    expect(evaluate(Object.create({ secret: 'inherited' }), 'secret')).toEqual([]);
  });

  it('returns fresh arrays and isolates inputs, variables and output options between runs', () => {
    const compiled = compile('%value');
    expect(Object.keys(compiled).sort()).toEqual(['evaluate', 'expression']);
    expect(Object.isFrozen(compiled)).toBe(true);
    const variables = { value: Decimal.parse('1.2300') };
    expect(compiled.evaluate(null, { variables, decimalOutput: 'string' })).toEqual(['1.2300']);
    expect(compiled.evaluate(null, { variables })).toEqual([1.23]);
    expect(evaluate(null, '%value', { variables, decimalOutput: 'string' })).toEqual(['1.2300']);
    expect(() => compiled.evaluate(null)).toThrow(
      expect.objectContaining({ code: 'eval/undefined-variable' }),
    );
    const path = compile('id');
    const first = path.evaluate({ id: 'a' });
    first.push('changed');
    expect(path.evaluate({ id: 'b' })).toEqual(['b']);
    const literal = compile('1');
    expect(literal.evaluate(null)).not.toBe(literal.evaluate(null));
  });

  // ADR-0012: exact Decimal strings are opt-in; input JSON numbers are already rounded.
  it('serializes exact Decimal and Quantity magnitudes without BigInt or internal wrappers', () => {
    const text = '9007199254740993.123400';
    expect(JSON.stringify(evaluate(null, text, { decimalOutput: 'string' }))).toBe(`["${text}"]`);
    expect(evaluate(null, text)).toEqual([Number(text)]);
    expect(evaluate(null, `${text} 'mg'`, { decimalOutput: 'string' })).toEqual([
      {
        value: text,
        unit: 'mg',
        code: 'mg',
        system: 'http://unitsofmeasure.org',
      },
    ]);
    expect(evaluate(null, '2 days', { decimalOutput: 'string' })).toEqual([
      { value: '2', unit: 'day' },
    ]);
    const parsed: unknown = JSON.parse('{"value":9007199254740993.123400}');
    expect(evaluate(parsed, 'value', { decimalOutput: 'string' })).toEqual([Number(text)]);
  });

  it.each([
    ['@2024-02', '2024-02'],
    ['@2024-02-01T10:30Z', '2024-02-01T10:30Z'],
    ['@T10:30', '10:30'],
  ])('renders %s as FHIR text', (expression, text) => {
    expect(evaluate(null, expression)).toEqual([text]);
  });

  it('accepts per-evaluation timezones consistently and rejects invalid offsets', () => {
    const compiled = compile('1');
    for (const timezoneOffset of [0, 60, 'local'] as const) {
      expect(compiled.evaluate(null, { timezoneOffset })).toEqual(
        evaluate(null, '1', { timezoneOffset }),
      );
    }
    for (const timezoneOffset of [841, 0.5, NaN]) {
      expect(() => compiled.evaluate(null, { timezoneOffset })).toThrow(
        expect.objectContaining({ code: 'eval/invalid-argument' }),
      );
      expect(() => evaluate(null, '1', { timezoneOffset })).toThrow(
        expect.objectContaining({ code: 'eval/invalid-argument' }),
      );
    }
  });

  it('exposes synchronous syntax, semantic and evaluation errors for display', () => {
    for (const [expression, errorClass, code] of [
      ['Patient.', FhirPathSyntaxError, 'syntax/unexpected-token'],
      ['where(true)', FhirPathSemanticError, 'semantic/unknown-function'],
      ['%missing', FhirPathEvaluationError, 'eval/undefined-variable'],
    ] as const) {
      try {
        evaluate(null, expression);
        expect.unreachable('expected a synchronous error');
      } catch (error) {
        expect(error).toBeInstanceOf(FhirPathError);
        expect(error).toBeInstanceOf(errorClass);
        if (!(error instanceof FhirPathError)) throw error;
        expect(error.code).toBe(code);
        expect(error.expression).toBe(expression);
        expect(error.span).toMatchObject({ line: 1 });
        expect(error.format()).toContain(code);
        if (error instanceof FhirPathSemanticError) expect(error.diagnostics[0]?.code).toBe(code);
      }
    }
  });

  it.each(['model', 'functions', 'hooks', 'strict', 'lenient', 'cache', 'output', 'now', 'limits'])(
    'rejects deferred %s options rather than silently ignoring them',
    (key) => {
      const options = { [key]: undefined };
      expect(() => compile('1', options as never)).toThrow(
        expect.objectContaining({ code: 'eval/invalid-argument' }),
      );
      expect(() => evaluate(null, '1', options as never)).toThrow(
        expect.objectContaining({ code: 'eval/invalid-argument' }),
      );
      expect(() => compile('1').evaluate(null, options as never)).toThrow(
        expect.objectContaining({ code: 'eval/invalid-argument' }),
      );
    },
  );

  it.each([null, [], 'options', 1])('rejects malformed options %j', (options) => {
    expect(() => compile('1', options as never)).toThrow(FhirPathEvaluationError);
    expect(() => evaluate(null, '1', options as never)).toThrow(FhirPathEvaluationError);
    expect(() => compile('1').evaluate(null, options as never)).toThrow(FhirPathEvaluationError);
  });

  it('validates expression and supported option values', () => {
    expect(() => compile({} as never)).toThrow(FhirPathEvaluationError);
    expect(() => evaluate(null, {} as never)).toThrow(FhirPathEvaluationError);
    for (const options of [{ units: {} }, { variables: [] }, { decimalOutput: 'bigint' }]) {
      expect(() => evaluate(null, '1', options as never)).toThrow(
        expect.objectContaining({ code: 'eval/invalid-argument' }),
      );
    }
    expect(
      evaluate(null, '1.50', Object.create({ decimalOutput: 'string', output: 'typed' })),
    ).toEqual([1.5]);
  });

  it('propagates input accessor errors without disguising them as expression errors', () => {
    const failure = new Error('input accessor failure');
    const input = {
      get value(): never {
        throw failure;
      },
    };
    expect(() => evaluate(input, 'value')).toThrow(failure);
    expect(() => compile('value').evaluate(input)).toThrow(failure);
  });

  it('keeps public types narrow without exposing deferred internal contracts', () => {
    expectTypeOf(compile('1')).toEqualTypeOf<CompiledExpression>();
    expectTypeOf(evaluate(null, '1')).toEqualTypeOf<unknown[]>();
    expectTypeOf<keyof CompileOptions>().toEqualTypeOf<'units'>();
    expectTypeOf<keyof EvaluateOptions>().toEqualTypeOf<
      'variables' | 'timezoneOffset' | 'decimalOutput'
    >();
    expectTypeOf<keyof CompiledExpression>().toEqualTypeOf<'expression' | 'evaluate'>();
    expectTypeOf<PlainQuantity['value']>().toEqualTypeOf<number | string>();
    expectTypeOf<SourceSpan['start']>().toEqualTypeOf<number>();
    expectTypeOf<CompileOptions['units']>().toEqualTypeOf<UnitSystem | undefined>();
    expectTypeOf<ModelProvider>().toBeObject();
  });
});
