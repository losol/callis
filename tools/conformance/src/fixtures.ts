import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSuite } from './parse-suite.ts';
import { SUITE_FILE_NAMES, type SuiteId, type TestSuite } from './suite.ts';

/** `tools/conformance/`. */
export const CONFORMANCE_DIR: string = fileURLToPath(new URL('../', import.meta.url));

/** The repository root. */
export const REPOSITORY_ROOT: string = fileURLToPath(new URL('../../../', import.meta.url));

/** `tools/conformance/fixtures/`, with one folder per suite. */
export const FIXTURES_DIR: string = join(CONFORMANCE_DIR, 'fixtures');

/** `fixtures/source.json`: where the vendored files come from. Written by `update-fixtures`. */
export interface FixtureSource {
  /** The upstream GitHub repository, `FHIR/fhir-test-cases`. */
  readonly repository: string;
  /** The pinned upstream commit SHA. */
  readonly commit: string;
  /** The commit date (ISO 8601). */
  readonly commitDate: string;
  /** Every vendored file, relative to `fixtures/`, mapped to its upstream path. */
  readonly files: Readonly<Record<string, VendoredFile>>;
}

/** One vendored file. */
export interface VendoredFile {
  /** The path in the upstream repository. */
  readonly upstream: string;
  /** SHA-256 of the file content, in hex. */
  readonly sha256: string;
}

/** Reads `fixtures/source.json`. */
export function readFixtureSource(): FixtureSource {
  const source: FixtureSource = JSON.parse(readFileSync(join(FIXTURES_DIR, 'source.json'), 'utf8'));
  return source;
}

/** The path of a suite's XML test file. */
export function suitePath(id: SuiteId): string {
  return join(FIXTURES_DIR, id, SUITE_FILE_NAMES[id]);
}

/** Reads and parses a vendored suite file. */
export function loadSuite(id: SuiteId): TestSuite {
  return parseSuite(readFileSync(suitePath(id), 'utf8'), id, SUITE_FILE_NAMES[id]);
}

/**
 * The JSON file an input is read from. JSON inputs are read as they are. An XML input `name.xml`
 * is read from `name.json` next to it, which the XML → JSON converter (T0023) writes.
 */
export function inputJsonName(inputFile: string): string {
  return inputFile.endsWith('.xml') ? `${inputFile.slice(0, -'.xml'.length)}.json` : inputFile;
}

/** The result of looking up a test's input file. */
export type InputLookup =
  | { readonly kind: 'json'; readonly path: string; readonly text: string }
  | { readonly kind: 'skip'; readonly reason: string };

/** Finds and reads a test's input. Injected into the runner so tests can use fakes. */
export type InputReader = (suite: SuiteId, inputFile: string) => InputLookup;

/** Reason used for XML inputs that have no converted JSON yet. */
export const NOT_CONVERTED = 'fixture not converted';

/** Reads inputs from `fixtures/<suite>/`. */
export function readFixtureInput(suite: SuiteId, inputFile: string): InputLookup {
  const name = inputJsonName(inputFile);
  const path = join(FIXTURES_DIR, suite, name);
  if (!existsSync(path)) {
    return {
      kind: 'skip',
      reason: name === inputFile ? `input file not found: ${inputFile}` : NOT_CONVERTED,
    };
  }
  return { kind: 'json', path, text: readFileSync(path, 'utf8') };
}
