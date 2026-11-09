/** Executable quick start, shared by the README and guide; imported by public-docs.test.ts. */
import { compile, evaluate, FhirPathError, parseJson } from '@callis/core';

export const patient: Readonly<{
  resourceType: string;
  name: readonly { given: readonly string[] }[];
}> = {
  resourceType: 'Patient',
  name: [{ given: ['Ada', 'Mina'] }],
};
export const given: unknown[] = evaluate(patient, 'Patient.name.given');
export const firstGiven: unknown[] = compile('name.given[0]').evaluate(patient);
export const filteredGiven: unknown[] = evaluate(patient, "name.where(given[0] = 'Ada').given");
export const questionnaire: Readonly<{
  resourceType: string;
  item: readonly { linkId: string; item?: readonly { linkId: string }[] }[];
}> = {
  resourceType: 'Questionnaire',
  item: [{ linkId: '1', item: [{ linkId: '1.1' }, { linkId: '1.2' }] }, { linkId: '2' }],
};
export const firstGivenPerName: unknown[] = evaluate(patient, 'name.select(given.first())');
export const linkIds: unknown[] = evaluate(questionnaire, 'Questionnaire.repeat(item).linkId');
export const onlyPatients: unknown[] = compile('ofType(Patient)').evaluate([
  patient,
  questionnaire,
]);
export const numberOfNames: unknown[] = evaluate(patient, 'name.count()');
export const hasAda: unknown[] = compile("name.exists(given[0] = 'Ada')").evaluate(patient);
export const filteredNameCount: unknown[] = evaluate(
  patient,
  "name.where(given[0] = 'Ada').count()",
);
export const noNames: unknown[] = evaluate(patient, 'name.empty()');
export const allGiven: unknown[] = compile('name.all(given.exists())').evaluate(patient);
export const someFalse: unknown[] = evaluate(null, 'true.combine(false).anyFalse()');
export const knownGiven: unknown[] = evaluate(
  patient,
  "name.given.subsetOf('Ada' | 'Mina' | 'Grace')",
);
export const uniqueGiven: unknown[] = evaluate(patient, "name.given.combine('Ada').distinct()");
export const givenDistinct: unknown[] = compile('name.given.isDistinct()').evaluate(patient);
export const selectedGiven: unknown[] = evaluate(patient, 'name.given.first()');
export const onlyName: unknown[] = compile('name.single()').evaluate(patient);
export const lastGiven: unknown[] = evaluate(patient, 'name.given.last()');
export const laterGiven: unknown[] = evaluate(patient, 'name.given.skip(1)');
export const firstTwoGiven: unknown[] = evaluate(patient, 'name.given.take(2)');
export const withoutAda: unknown[] = evaluate(patient, "name.given.exclude('Ada')");
export const withGrace: unknown[] = compile("name.given.union('Grace')").evaluate(patient);
export const adaTwice: unknown[] = evaluate(patient, "name.given.take(1).combine('Ada')");
export const named: unknown[] = evaluate(patient, "iif(name.exists(), 'named', 'unnamed')");
export const parsedDecimal: unknown[] = evaluate(null, "'1.50'.toDecimal()", {
  decimalOutput: 'string',
});
export const inHours: unknown[] = evaluate(null, "'4 days'.toQuantity('h').toString()");
export const exactDecimal: unknown[] = evaluate(null, '9007199254740993.1200', {
  decimalOutput: 'string',
});
export const quantityJson: string = JSON.stringify(
  evaluate(null, "1.200 'mg'", { decimalOutput: 'string' }),
);
export const variable: unknown[] = compile('%value').evaluate(null, {
  variables: { value: 'hello' },
});
export const lossless: unknown[] = evaluate(parseJson('{"value": 1.50}'), 'value', {
  decimalOutput: 'string',
});
export const organization: Readonly<{ resourceType: string; id: string; name: string }> = {
  resourceType: 'Organization',
  id: 'o1',
  name: 'Acme',
};
export const withContained: Readonly<{
  resourceType: string;
  contained: readonly object[];
  managingOrganization: { reference: string };
}> = {
  resourceType: 'Patient',
  contained: [organization],
  managingOrganization: { reference: '#o1' },
};
export const managedBy: unknown[] = evaluate(withContained, 'managingOrganization.resolve().name');
export const containerReference: unknown[] = evaluate(
  organization,
  '%rootResource.managingOrganization.reference',
  { rootResource: withContained },
);

/** Keep non-expression errors distinguishable from FHIRPath diagnostics. */
export function expressionError(): string {
  try {
    compile('Patient.');
    return '';
  } catch (error) {
    if (error instanceof FhirPathError) return error.format();
    throw error;
  }
}
