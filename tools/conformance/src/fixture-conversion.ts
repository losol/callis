/**
 * Which XML inputs of the vendored suites are converted to JSON, and how (T0023).
 *
 * Each FHIR XML input `name.xml` that a suite references is converted with the suite's FHIR model
 * and committed as `name.json` next to it, which is where the runner reads it
 * (`inputJsonName()`). `pnpm --filter @callis/conformance convert-fixtures` writes the files, and
 * a unit test checks that they are up to date.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelProvider } from '../../../packages/core/src/model/model-provider.ts';
import { r4 } from '../../../packages/fhir-r4/src/index.ts';
import { r5 } from '../../../packages/fhir-r5/src/index.ts';
import { convertFhirXml } from './fhir-xml.ts';
import { FIXTURES_DIR, inputJsonName, readFixtureSource } from './fixtures.ts';
import { stringifyJson } from './json-text.ts';
import { compareOrdinal } from './ordinal.ts';
import { allTests, type SuiteId, type TestSuite } from './suite.ts';

/** The FHIR model each suite's inputs are read with. */
export const SUITE_MODELS: Readonly<Record<SuiteId, ModelProvider>> = { r4, r5 };

/** An XML input that is not converted, and why. */
export interface UnconvertedInput {
  readonly suite: SuiteId;
  readonly file: string;
  readonly reason: string;
}

/**
 * XML inputs that are not FHIR resources, so they are not converted. Only unsupported tests may
 * use them, which a unit test checks; every phase-1 and STU test gets its input.
 */
export const UNCONVERTED_INPUTS: readonly UnconvertedInput[] = [
  {
    suite: 'r5',
    file: 'ccda.xml',
    reason: 'a CDA document, not FHIR; only the out-of-scope `cdaTests` group uses it',
  },
];

/** One converted input. */
export interface FixtureConversion {
  readonly suite: SuiteId;
  /** The XML input, relative to the suite's fixture folder. */
  readonly input: string;
  /** The JSON file it is written to, relative to the suite's fixture folder. */
  readonly output: string;
  /** The JSON text. */
  readonly json: string;
}

/** The XML inputs a suite references, in ordinal order. */
export function xmlInputs(suite: TestSuite): string[] {
  const inputs = new Set(allTests(suite).flatMap((test) => test.inputFile ?? []));
  return [...inputs].filter((input) => input.endsWith('.xml')).sort(compareOrdinal);
}

/** Whether an XML input is listed in {@link UNCONVERTED_INPUTS}. */
export function isUnconverted(suite: SuiteId, input: string): boolean {
  return UNCONVERTED_INPUTS.some((entry) => entry.suite === suite && entry.file === input);
}

/** Converts one vendored XML input of a suite to JSON text. */
export function convertFixture(suite: SuiteId, input: string): string {
  const xml = readFileSync(join(FIXTURES_DIR, suite, input), 'utf8');
  try {
    return stringifyJson(convertFhirXml(xml, SUITE_MODELS[suite]));
  } catch (error) {
    throw new Error(
      `${suite}/${input}: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
}

/** Converts every XML input of a suite, except the unconverted ones. */
export function convertSuiteFixtures(suite: TestSuite): FixtureConversion[] {
  return xmlInputs(suite)
    .filter((input) => !isUnconverted(suite.id, input))
    .map((input) => ({
      suite: suite.id,
      input,
      output: inputJsonName(input),
      json: convertFixture(suite.id, input),
    }));
}

/**
 * The converted JSON files in a suite's fixture folder: the `.json` files that are not vendored.
 * Relative to the folder, in ordinal order.
 */
export function convertedFiles(suite: SuiteId): string[] {
  const vendored = readFixtureSource().files;
  return readdirSync(join(FIXTURES_DIR, suite))
    .filter((name) => name.endsWith('.json') && !Object.hasOwn(vendored, `${suite}/${name}`))
    .sort(compareOrdinal);
}
