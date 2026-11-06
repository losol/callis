/**
 * Official FHIR JSON examples that the converted fixtures are checked against (T0023).
 *
 * Several suite inputs are copies of examples from the FHIR specification. For those, the
 * converted JSON is compared with the official JSON example from the `hl7.fhir.r4.examples` and
 * `hl7.fhir.r5.examples` packages, vendored in `official-examples/`. Every difference is listed
 * here with its reason, and a unit test checks that the differences are exactly these.
 *
 * The reasons were checked by also converting the XML published on hl7.org: it gives the official
 * JSON except for the `xhtml-serialization` and `package-build` differences below.
 */
import { join } from 'node:path';
import { CONFORMANCE_DIR } from './fixtures.ts';
import { NumberLexeme } from './json-text.ts';
import type { SuiteId } from './suite.ts';

/** `tools/conformance/official-examples/`, with one folder per suite. */
export const OFFICIAL_EXAMPLES_DIR: string = join(CONFORMANCE_DIR, 'official-examples');

/** The package the official examples of a suite come from. */
export interface ExamplePackage {
  readonly name: string;
  readonly version: string;
  /** SHA-256 of the package archive, in hex. */
  readonly sha256: string;
}

/** The pinned example packages. Their license is CC0-1.0. */
export const EXAMPLE_PACKAGES: Readonly<Record<SuiteId, ExamplePackage>> = {
  r4: {
    name: 'hl7.fhir.r4.examples',
    version: '4.0.1',
    sha256: 'e18b31e7a52145a31f1f3f409cf6847583b08b7306cc4e9460a95a7b5efba930',
  },
  r5: {
    name: 'hl7.fhir.r5.examples',
    version: '5.0.0',
    sha256: '129eb96eaeab3b14b4c3a89a2e3593a0a79ebddb56ef46e15fac6928a0a5976e',
  },
};

/**
 * Why a converted fixture differs from the official example:
 *
 * - `xhtml-serialization`: the official JSON writes the narrative XHTML anew (other whitespace,
 *   `'` for `&#39;`); the converter copies it as the XML writes it. Both are the same XHTML.
 * - `package-build`: the examples package adds metadata that the published XML does not have.
 * - `fixture-edit`: the suite's copy of the example differs from the published one, because the
 *   suite changed it for its tests or copied an older version.
 */
export type DifferenceReason = 'xhtml-serialization' | 'package-build' | 'fixture-edit';

/** Differences with one reason. */
export interface KnownDifference {
  readonly reason: DifferenceReason;
  /** Where the JSON differs, as {@link diffJson} writes them. */
  readonly paths: readonly string[];
  /** What differs. */
  readonly note: string;
}

/** A suite input that is a copy of an official example. */
export interface OfficialExample {
  readonly suite: SuiteId;
  /** The XML input in `fixtures/<suite>/`. */
  readonly fixture: string;
  /** The official JSON example in `official-examples/<suite>/`, named as in the package. */
  readonly official: string;
  readonly differences: readonly KnownDifference[];
}

const PACKAGE_METADATA =
  'The examples package adds `meta.lastUpdated` and a work group extension, and sets `version` to the FHIR version.';

/** The suite inputs that have an official JSON example, with every known difference. */
export const OFFICIAL_EXAMPLES: readonly OfficialExample[] = [
  {
    suite: 'r4',
    fixture: 'patient-example.xml',
    official: 'Patient-example.json',
    differences: [],
  },
  {
    suite: 'r4',
    fixture: 'observation-example.xml',
    official: 'Observation-example.json',
    differences: [
      {
        reason: 'xhtml-serialization',
        paths: ['text.div'],
        note: "The official JSON writes the narrative's `&#39;` references as `'`.",
      },
      {
        reason: 'fixture-edit',
        paths: ['extension'],
        note: 'The suite adds an extension with an `Age` value.',
      },
    ],
  },
  {
    suite: 'r4',
    fixture: 'codesystem-example.xml',
    official: 'CodeSystem-example.json',
    differences: [
      {
        reason: 'package-build',
        paths: ['meta.lastUpdated', 'version', 'extension'],
        note: PACKAGE_METADATA,
      },
      {
        reason: 'fixture-edit',
        paths: ['text', 'description', 'concept[0].code'],
        note: 'The suite removes the narrative, writes `description` across two lines (XML turns the line break into a space and keeps the indentation), and makes the first code a duplicate `chol-mass` ("wrong!").',
      },
    ],
  },
  {
    suite: 'r4',
    fixture: 'questionnaire-example.xml',
    official: 'Questionnaire-3141.json',
    differences: [],
  },
  {
    suite: 'r4',
    fixture: 'valueset-example-expansion.xml',
    official: 'ValueSet-example-expansion.json',
    differences: [
      {
        reason: 'package-build',
        paths: ['meta.lastUpdated', 'version', 'extension'],
        note: PACKAGE_METADATA,
      },
      {
        reason: 'xhtml-serialization',
        paths: ['text.div'],
        note: 'The official JSON indents the narrative differently.',
      },
    ],
  },
  {
    suite: 'r5',
    fixture: 'patient-example.xml',
    official: 'Patient-example.json',
    differences: [
      { reason: 'package-build', paths: ['meta'], note: 'The examples package adds `meta`.' },
      {
        reason: 'fixture-edit',
        paths: ['text.div'],
        note: 'The suite keeps the R4 narrative; R5 publishes a generated one.',
      },
    ],
  },
  {
    suite: 'r5',
    fixture: 'observation-example.xml',
    official: 'Observation-example.json',
    differences: [
      { reason: 'package-build', paths: ['meta'], note: 'The examples package adds `meta`.' },
      {
        reason: 'fixture-edit',
        paths: ['text.div', 'extension'],
        note: 'The suite keeps the R4 narrative (R5 publishes a generated one) and adds an extension with an `Age` value.',
      },
    ],
  },
  {
    suite: 'r5',
    fixture: 'codesystem-example.xml',
    official: 'CodeSystem-example.json',
    differences: [
      {
        reason: 'fixture-edit',
        paths: [
          'text',
          'identifier[0].system',
          'identifier[0].value',
          'identifier[1]',
          'version',
          'description',
          'concept[0].code',
        ],
        note: 'The suite copies the R4 example, with its edits (see R4); R5 publishes it with a narrative, other identifiers and version `5.0.0`.',
      },
    ],
  },
  {
    suite: 'r5',
    fixture: 'questionnaire-example.xml',
    official: 'Questionnaire-3141.json',
    differences: [
      {
        reason: 'fixture-edit',
        paths: ['text.div', 'identifier', 'name', 'description'],
        note: 'The suite copies the R4 example; R5 adds an identifier, a name and a description, and changes the narrative.',
      },
    ],
  },
  {
    suite: 'r5',
    fixture: 'valueset-example-expansion.xml',
    official: 'ValueSet-example-expansion.json',
    differences: [
      {
        reason: 'fixture-edit',
        paths: [
          'text.status',
          'text.div',
          'identifier',
          'version',
          'name',
          'title',
          'expansion.extension[0].valueUri',
          'expansion.property',
          'expansion.contains[0].property',
          'expansion.contains[1].contains[0].property',
          'expansion.contains[1].contains[1].property',
          'expansion.contains[1].contains[2].property',
          'expansion.contains[2].contains[0].property',
          'expansion.contains[2].contains[1].property',
          'expansion.contains[2].contains[2].property',
          'expansion.contains[2].contains[3].property',
        ],
        note: 'The suite copies the R4 example; R5 adds an identifier, a title, concept properties and a computable name, and changes the narrative and the extension value.',
      },
    ],
  },
];

/** The path of an official example. */
export function officialExamplePath(example: OfficialExample): string {
  return join(OFFICIAL_EXAMPLES_DIR, example.suite, example.official);
}

/**
 * Where two JSON values differ, as paths like `name[0].given` (empty for the root). A property or
 * item that only one side has is one difference; so is a different primitive. Numbers must be
 * {@link NumberLexeme}s and compare by their text, so `1.50` differs from `1.5`. Shared properties
 * in a different order give `<path> (order)`, or `(order)` at the root.
 */
export function diffJson(actual: unknown, expected: unknown, path = ''): string[] {
  if (actual instanceof NumberLexeme || expected instanceof NumberLexeme) {
    const same =
      actual instanceof NumberLexeme &&
      expected instanceof NumberLexeme &&
      actual.text === expected.text;
    return same ? [] : [path];
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    const differences: string[] = [];
    for (let index = 0; index < Math.max(actual.length, expected.length); index++) {
      const itemPath = `${path}[${index}]`;
      if (index >= actual.length || index >= expected.length) differences.push(itemPath);
      else differences.push(...diffJson(actual[index], expected[index], itemPath));
    }
    return differences;
  }
  if (isPlainObject(actual) && isPlainObject(expected)) {
    const differences: string[] = [];
    const actualKeys = Object.keys(actual);
    const expectedKeys = Object.keys(expected);
    for (const key of new Set([...actualKeys, ...expectedKeys])) {
      const keyPath = path === '' ? key : `${path}.${key}`;
      if (!Object.hasOwn(actual, key) || !Object.hasOwn(expected, key)) differences.push(keyPath);
      else differences.push(...diffJson(actual[key], expected[key], keyPath));
    }
    const shared = actualKeys.filter((key) => Object.hasOwn(expected, key));
    if (shared.join('\n') !== expectedKeys.filter((key) => Object.hasOwn(actual, key)).join('\n')) {
      differences.push(path === '' ? '(order)' : `${path} (order)`);
    }
    return differences;
  }
  return actual === expected ? [] : [path];
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
