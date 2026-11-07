/** Synthetic examples for the initial model-less public API; each runs in tests. */
export const examples = [
  { name: 'Given names', expression: 'Patient.name.given', expected: ['Ada', 'June', 'Alex'] },
  { name: 'First name', expression: 'Patient.name[0].given', expected: ['Ada', 'June'] },
  {
    name: 'Filtered names',
    expression: "Patient.name.where(family = 'Example').given",
    expected: ['Ada', 'June'],
  },
  { name: 'Missing field', expression: 'Patient.address', expected: [] },
  { name: 'Boolean logic', expression: 'Patient.active and true', expected: [true] },
  { name: 'Exact decimal', expression: '0.1 + 0.2', expected: ['0.3'] },
] as const;

/** The patient is invented and contains no real patient data. */
export const exampleInput = JSON.stringify(
  {
    resourceType: 'Patient',
    id: 'example',
    active: true,
    name: [{ family: 'Example', given: ['Ada', 'June'] }, { given: ['Alex'] }],
  },
  null,
  2,
);
