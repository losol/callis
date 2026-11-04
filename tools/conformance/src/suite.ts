/**
 * The HL7 FHIRPath test suite as plain data. `parseSuite()` builds it from the XML test files; the
 * schema is `fixtures/r5/testSchema.xsd`.
 */

/** The two vendored suite files: `tests-fhir-r4.xml` and `tests-fhir-r5.xml`. */
export type SuiteId = 'r4' | 'r5';

/** Every suite, in report order. */
export const SUITE_IDS: readonly SuiteId[] = ['r4', 'r5'];

/** The `type` values of an `<output>` element. */
export type OutputType =
  | 'boolean'
  | 'integer'
  | 'decimal'
  | 'string'
  | 'date'
  | 'dateTime'
  | 'time'
  | 'code'
  | 'id'
  | 'Quantity';

/**
 * The error a test expects (`<expression invalid="…">`). `true` accepts any FHIRPath error.
 * `invalid="false"` means no error and is represented as `undefined`.
 */
export type InvalidKind = 'syntax' | 'semantic' | 'execution' | 'true';

/** One expected result item. */
export interface ExpectedOutput {
  /**
   * The expected type. Undefined for the untyped outputs in the R4 file, whose text is a FHIRPath
   * literal (for example `10.0` or `@2014-01`).
   */
  readonly type: OutputType | undefined;
  /** The element text, exactly as in the file. */
  readonly text: string;
}

/** One `<test>` element. */
export interface SuiteTest {
  /**
   * Unique within its suite file. This is the test name, except that the second and later tests
   * with the same name get a `#2`, `#3`, … suffix (the R4 file has two `testEquivalent23`).
   */
  readonly id: string;
  readonly name: string;
  readonly group: string;
  /** 1-based line of the `<test>` tag, for links into the suite file. */
  readonly line: number;
  readonly description: string | undefined;
  /** The function, operator or feature under test (the `testing` attribute). */
  readonly testing: string | undefined;
  /** The expression, trimmed. */
  readonly expression: string;
  readonly invalid: InvalidKind | undefined;
  /** Expected results in document order. No outputs and no `invalid` means an empty result. */
  readonly outputs: readonly ExpectedOutput[];
  /** The input file name, relative to the suite's fixture folder. */
  readonly inputFile: string | undefined;
  /**
   * The evaluation mode: the test's `mode`, else the `mode` on its `<expression>` (R4 only), else
   * the group's `mode`.
   */
  readonly mode: string | undefined;
  /** `predicate="true"`: the result is converted to a Boolean before it is compared. */
  readonly predicate: boolean;
  /** The `ordered` attribute. `false` compares outputs as a multiset; otherwise order matters. */
  readonly ordered: boolean | undefined;
  /**
   * Whether ordered functions on unordered input must be reported (`checkOrderedFunctions` in R4,
   * `ordered="true"` in R5; see `docs/spec-notes.md`).
   */
  readonly checkOrderedFunctions: boolean;
  /** An expression that selects the focus inside the input (`context`). */
  readonly context: string | undefined;
  /** The declared type(s) of the context (`contextType`, `|`-separated in the file). */
  readonly contextTypes: readonly string[];
  /** The FHIRPath version that introduced the feature under test, for example `2.1.0`. */
  readonly version: string | undefined;
  /** `skipStaticCheck="true"`: run the test without static analysis. */
  readonly skipStaticCheck: boolean;
}

/** One `<group>` element. */
export interface SuiteGroup {
  readonly name: string;
  readonly description: string | undefined;
  readonly mode: string | undefined;
  readonly tests: readonly SuiteTest[];
}

/** A parsed suite file. */
export interface TestSuite {
  readonly id: SuiteId;
  /** The file name inside `fixtures/<id>/`, for example `tests-fhir-r5.xml`. */
  readonly fileName: string;
  readonly groups: readonly SuiteGroup[];
}

/** The suite file name for each suite. */
export const SUITE_FILE_NAMES: Readonly<Record<SuiteId, string>> = {
  r4: 'tests-fhir-r4.xml',
  r5: 'tests-fhir-r5.xml',
};

/** Every test of a suite, in document order. */
export function allTests(suite: TestSuite): SuiteTest[] {
  return suite.groups.flatMap((group) => group.tests);
}
