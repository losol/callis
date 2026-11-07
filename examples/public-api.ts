/** Executable quick start, shared by the README and guide; imported by public-docs.test.ts. */
import { compile, evaluate, FhirPathError } from '@callis/core';

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
export const exactDecimal: unknown[] = evaluate(null, '9007199254740993.1200', {
  decimalOutput: 'string',
});
export const quantityJson: string = JSON.stringify(
  evaluate(null, "1.200 'mg'", { decimalOutput: 'string' }),
);
export const variable: unknown[] = compile('%value').evaluate(null, {
  variables: { value: 'hello' },
});

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
