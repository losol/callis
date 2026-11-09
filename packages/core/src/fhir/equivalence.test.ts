import { describe, expect, it } from 'vitest';
import { stubModel } from '../../test/support/stub-model.ts';
import { type CompileOptions, type EvaluateOptions, evaluate } from '../api/compile.ts';
import { ModelNode } from '../model/model-node.ts';
import type { ModelProvider } from '../model/model-provider.ts';
import { itemEquivalent } from '../runtime/equality.ts';
import { navigateMember, toInputCollection } from '../runtime/navigation.ts';
import { minimalUnitSystem } from '../values/quantity/unit-system.ts';
import { fhirEquivalence } from './equivalence.ts';

const LOINC = 'http://loinc.org';
const SNOMED = 'http://snomed.info/sct';

/** Two Observations whose `code`, and the first coding of each, are compared. */
function pair(left: object, right: object): object {
  return {
    resourceType: 'Patient',
    contained: [
      { resourceType: 'Observation', code: left },
      { resourceType: 'Observation', code: right },
    ],
  };
}

function run(
  input: unknown,
  expression: string,
  options: CompileOptions & EvaluateOptions = { model: stubModel },
): unknown[] {
  return evaluate(input, expression, options);
}

const codes = (left: object, right: object, operator = '~'): unknown[] =>
  run(pair(left, right), `contained[0].code ${operator} contained[1].code`);
const codings = (left: object, right: object, operator = '~'): unknown[] =>
  run(
    pair({ coding: [left] }, { coding: [right] }),
    `contained[0].code.coding ${operator} contained[1].code.coding`,
  );

// https://hl7.org/fhir/R5/fhirpath.html#changes
describe('FHIR equivalence of a Coding', () => {
  it('compares system and code only', () => {
    expect(
      codings(
        { system: LOINC, code: '8480-6', display: 'Systolic', version: '2.7', userSelected: true },
        { system: LOINC, code: '8480-6', display: 'Other text' },
      ),
    ).toEqual([true]);
    expect(codings({ system: LOINC, code: '8480-6' }, { system: SNOMED, code: '8480-6' })).toEqual([
      false,
    ]);
    expect(codings({ system: LOINC, code: '8480-6' }, { system: LOINC, code: '8462-4' })).toEqual([
      false,
    ]);
    expect(codings({ system: LOINC, code: '8480-6' }, { code: '8480-6' })).toEqual([false]);
    expect(codings({ display: 'a' }, { display: 'b' })).toEqual([true]);
  });

  it('compares system and code with string equivalence', () => {
    expect(codings({ system: LOINC, code: 'abc' }, { system: LOINC, code: 'ABC' })).toEqual([true]);
  });

  it('keeps every element for =', () => {
    expect(
      codings({ system: LOINC, code: '1', display: 'a' }, { system: LOINC, code: '1' }, '='),
    ).toEqual([false]);
  });
});

describe('FHIR equivalence of a CodeableConcept', () => {
  it('is true when some coding of one is equivalent to some coding of the other', () => {
    expect(
      codes(
        {
          coding: [
            { system: SNOMED, code: '1' },
            { system: LOINC, code: '2' },
          ],
          text: 'a',
        },
        { coding: [{ system: LOINC, code: '2', display: 'x' }], text: 'b' },
      ),
    ).toEqual([true]);
    expect(
      codes(
        { coding: [{ system: SNOMED, code: '1' }] },
        { coding: [{ system: LOINC, code: '1' }] },
      ),
    ).toEqual([false]);
  });

  it('is false when either has no codings, whatever the text says', () => {
    expect(codes({ text: 'same' }, { text: 'same' })).toEqual([false]);
    expect(codes({ coding: [{ system: LOINC, code: '2' }] }, { text: 'x' })).toEqual([false]);
  });

  it('gives the same result for one shared JSON object as for two copies', () => {
    const textOnly = { text: 'same' };
    const coded = { coding: [{ system: LOINC, code: '2' }] };
    for (const code of [textOnly, coded]) {
      const expected = code === coded;
      const shared = { resourceType: 'Observation', code };
      expect(run(shared, 'code ~ code')).toEqual([expected]);
      expect(run(shared, 'code !~ code')).toEqual([!expected]);
      expect(run(shared, '$this ~ $this')).toEqual([expected]);
      expect(codes(code, code)).toEqual([expected]);
      expect(codes(code, structuredClone(code))).toEqual([expected]);
      // Nested in one shared object: the Observation holds a text-only code.
      const twice = { resourceType: 'Patient', contained: [shared, shared] };
      expect(run(twice, 'contained[0] ~ contained[1]')).toEqual([expected]);
      expect(
        run(
          { resourceType: 'Patient', contained: [shared, structuredClone(shared)] },
          'contained[0] ~ contained[1]',
        ),
      ).toEqual([expected]);
    }
    // Without a model the identity shortcut still applies.
    expect(run({ resourceType: 'Observation', code: textOnly }, 'code ~ code', {})).toEqual([true]);
  });

  it('keeps every element for =', () => {
    expect(
      codes(
        { coding: [{ system: LOINC, code: '2' }], text: 'a' },
        { coding: [{ system: LOINC, code: '2' }], text: 'b' },
        '=',
      ),
    ).toEqual([false]);
  });
});

describe('FHIR equivalence of other complex values', () => {
  const contacts = (left: object, right: object): object => ({
    resourceType: 'Patient',
    contact: [left, right],
  });

  it('ignores id elements, at every level', () => {
    const input = contacts(
      { id: 'a', period: { id: 'x', start: '2020' }, name: { family: 'Doe' } },
      { id: 'b', period: { start: '2020' }, name: { id: 'n', family: 'DOE' } },
    );
    expect(run(input, 'contact[0] ~ contact[1]')).toEqual([true]);
    expect(run(input, 'contact[0] = contact[1]')).toEqual([false]);
    expect(
      run(
        { resourceType: 'Patient', contained: [organization('o1'), organization('o2')] },
        'contained[0] ~ contained[1]',
      ),
    ).toEqual([true]);
  });

  it('still needs the other elements to be equivalent', () => {
    expect(
      run(
        contacts({ name: { family: 'Doe' } }, { name: { family: 'Roe' } }),
        'contact[0] ~ contact[1]',
      ),
    ).toEqual([false]);
    expect(
      run(
        contacts({ id: 'a', name: { family: 'Doe' } }, { id: 'a', period: { start: '2020' } }),
        'contact[0] ~ contact[1]',
      ),
    ).toEqual([false]);
  });

  it('applies to codings nested in other values', () => {
    const input = contacts(
      { relationship: [{ coding: [{ system: LOINC, code: 'N', display: 'one' }] }] },
      { relationship: [{ coding: [{ system: LOINC, code: 'N' }], text: 'two' }] },
    );
    expect(run(input, 'contact[0] ~ contact[1]')).toEqual([true]);
  });

  it('does not apply without a model', () => {
    const input = contacts(
      { id: 'a', name: { family: 'Doe' } },
      { id: 'b', name: { family: 'Doe' } },
    );
    expect(run(input, 'contact[0] ~ contact[1]', {})).toEqual([false]);
  });
});

function organization(id: string): object {
  return { resourceType: 'Organization', id, name: 'Acme' };
}

describe('fhirEquivalence', () => {
  const context = (model: ModelProvider | undefined) => ({
    model,
    units: minimalUnitSystem,
    timezoneOffset: 0,
    modelEquivalence: fhirEquivalence,
  });

  it('leaves untyped nodes and other namespaces to the default rule', () => {
    const a = new ModelNode({ value: { id: 'a' }, name: 'x' });
    const b = new ModelNode({ value: { id: 'b' }, name: 'x' });
    expect(fhirEquivalence(a, b, context(stubModel))).toBeUndefined();
    const other: ModelProvider = { ...stubModel, namespace: 'Other' };
    const [left, right] = navigateMember(
      toInputCollection(
        { resourceType: 'Patient', contact: [{ id: 'a' }, { id: 'b' }] },
        '',
        stubModel,
      ),
      'contact',
      { model: stubModel, lenientChoiceSuffix: false },
    );
    if (!(left instanceof ModelNode) || !(right instanceof ModelNode)) throw new Error('no nodes');
    const foreign = (node: ModelNode) =>
      new ModelNode({
        value: node.value,
        name: node.name,
        type: node.type && { ...node.type, namespace: 'Other' },
      });
    expect(fhirEquivalence(foreign(left), foreign(right), context(other))).toBeUndefined();
    expect(fhirEquivalence(left, right, context(undefined))).toBeUndefined();
    expect(fhirEquivalence(left, right, context(stubModel))).toBe(true);
    expect(itemEquivalent(left, right, context(stubModel))).toBe(true);
  });
});
