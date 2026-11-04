/**
 * Tags each suite test as phase 1, STU (phase 2) or unsupported, so progress is measured against
 * the right target (ADR-0001). See `docs/architecture.md#specification-baseline-and-scope`.
 */
import { decodeEscapes } from './escapes.ts';
import type { SuiteTest } from './suite.ts';

/** Which part of the roadmap a test belongs to. */
export type Phase = 'phase1' | 'stu' | 'unsupported';

/** Every phase, in report order. */
export const PHASES: readonly Phase[] = ['phase1', 'stu', 'unsupported'];

/** Display names of the phases. */
export const PHASE_LABELS: Readonly<Record<Phase, string>> = {
  phase1: 'Phase 1',
  stu: 'STU',
  unsupported: 'Unsupported',
};

/** A test's phase, with the reason when it is not phase 1. */
export interface Classification {
  readonly phase: Phase;
  /** Why the test is STU or unsupported. Unsupported tests are skipped with this reason. */
  readonly reason: string | undefined;
  /** The task that implements the feature, for STU tests. */
  readonly task: string | undefined;
}

/** The FHIRPath version of the phase-1 baseline (N1). Tests for newer versions are STU. */
const BASELINE_VERSION = '2.0.0';

/** Modes that are part of phase 1 (ADR-0012, T0018, T0020, T0024). */
const PHASE1_MODES: ReadonlySet<string> = new Set([
  'strict',
  'lenient',
  'lenient/polymorphics',
  'element',
  'html',
  // Group-level mode of `isSemanticChecks`: type checks with `contextType` (T0024).
  'semantic',
]);

/** Modes that are out of scope. */
const UNSUPPORTED_MODES: Readonly<Record<string, string>> = {
  cda: 'CDA logical model (mode="cda")',
  custom: 'engine-specific extension functions (mode="custom")',
};

/** Groups that are out of scope, whatever their mode says. */
const UNSUPPORTED_GROUPS: Readonly<Record<string, string>> = {
  cdaTests: 'CDA logical model (out of scope)',
  documentFunctions: 'HL7 Java engine document functions (out of scope)',
};

/**
 * STU functions, by name, with the task that implements them. A test that calls one is STU.
 * Sources: N1 §7 and §10.2 (STU in N1), FHIRPath 3.0.0 additions, and R5 §2.1.9.1.5–2.1.9.5.
 */
const STU_FUNCTIONS: Readonly<Record<string, string>> = {
  aggregate: 'T0026',
  sum: 'T0026',
  min: 'T0026',
  max: 'T0026',
  avg: 'T0026',
  defineVariable: 'T0026',
  sort: 'T0027',
  coalesce: 'T0027',
  repeatAll: 'T0027',
  pathname: 'T0027',
  toLong: 'T0028',
  convertsToLong: 'T0028',
  lastIndexOf: 'T0029',
  matchesFull: 'T0029',
  encode: 'T0029',
  decode: 'T0029',
  escape: 'T0029',
  unescape: 'T0029',
  trim: 'T0029',
  split: 'T0029',
  join: 'T0029',
  lowBoundary: 'T0030',
  highBoundary: 'T0030',
  precision: 'T0030',
  comparable: 'T0030',
  yearOf: 'T0030',
  monthOf: 'T0030',
  dayOf: 'T0030',
  hourOf: 'T0030',
  minuteOf: 'T0030',
  secondOf: 'T0030',
  millisecondOf: 'T0030',
  timezoneOffsetOf: 'T0030',
  dateOf: 'T0030',
  timeOf: 'T0030',
  duration: 'T0030',
  difference: 'T0030',
  type: 'T0031',
  elementDefinition: 'T0032',
  slice: 'T0032',
  checkModifiers: 'T0032',
};

/** STU syntax and variables. */
const STU_PATTERNS: readonly StuFeature[] = [
  { pattern: /\$total\b/, what: '$total', task: 'T0026' },
  { pattern: /(?<![\w.@])\d+L\b/, what: 'Long literal', task: 'T0028' },
  { pattern: /%terminologies\b/, what: '%terminologies', task: 'T0032' },
  { pattern: /%server\b/, what: '%server', task: 'T0032' },
  { pattern: /%factory\b/, what: '%factory', task: 'T0032' },
];

interface StuFeature {
  readonly pattern: RegExp;
  readonly what: string;
  readonly task: string;
}

/** Groups whose tests are all STU, including the ones that do not call an STU function. */
const STU_GROUPS: Readonly<Record<string, string>> = {
  defineVariable: 'T0026',
  testAggregate: 'T0026',
  testSort: 'T0027',
  testEncodeDecode: 'T0029',
  testEscapeUnescape: 'T0029',
  testTrim: 'T0029',
  testSplit: 'T0029',
  testJoin: 'T0029',
  LowBoundary: 'T0030',
  HighBoundary: 'T0030',
  Precision: 'T0030',
  Comparable: 'T0030',
  TerminologyTests: 'T0032',
};

const PHASE1: Classification = { phase: 'phase1', reason: undefined, task: undefined };

/**
 * Classifies a test. The first matching rule wins:
 *
 * 1. out-of-scope group or mode → unsupported
 * 2. unknown mode → unsupported
 * 3. `version` newer than N1 (2.0.0) → STU
 * 4. `mode="tx"` (`%terminologies`) → STU
 * 5. the expression calls an STU function or uses STU syntax → STU
 * 6. an STU group → STU
 * 7. otherwise phase 1
 */
export function classifyTest(test: SuiteTest): Classification {
  const mode = test.mode;
  if (Object.hasOwn(UNSUPPORTED_GROUPS, test.group)) {
    return unsupported(UNSUPPORTED_GROUPS[test.group]);
  }
  if (mode !== undefined && Object.hasOwn(UNSUPPORTED_MODES, mode)) {
    return unsupported(UNSUPPORTED_MODES[mode]);
  }
  if (mode !== undefined && mode !== 'tx' && !PHASE1_MODES.has(mode)) {
    return unsupported(`unknown mode "${mode}"`);
  }
  if (test.version !== undefined && compareVersions(test.version, BASELINE_VERSION) > 0) {
    return { phase: 'stu', reason: `needs FHIRPath ${test.version}`, task: undefined };
  }
  if (mode === 'tx') {
    return stu('%terminologies (mode="tx")', 'T0032');
  }
  const feature = findStuFeature(test.expression);
  if (feature !== undefined) {
    return stu(feature.what, feature.task);
  }
  if (Object.hasOwn(STU_GROUPS, test.group)) {
    return stu(`STU group ${test.group}`, STU_GROUPS[test.group]);
  }
  return PHASE1;
}

/**
 * The first STU function or syntax in an expression. Strings and comments are ignored, and a
 * delimited identifier counts as its name, so ``(2 | 1).`sort`()`` calls `sort()`.
 */
export function findStuFeature(
  expression: string,
): { readonly what: string; readonly task: string } | undefined {
  const code = prepareForScan(expression);
  for (const match of code.matchAll(/(?<!\w)([A-Za-z_]\w*)\s*\(/g)) {
    const name = match[1] ?? '';
    if (Object.hasOwn(STU_FUNCTIONS, name)) {
      return { what: `${name}()`, task: STU_FUNCTIONS[name] ?? '' };
    }
  }
  for (const { pattern, what, task } of STU_PATTERNS) {
    if (pattern.test(code)) {
      return { what, task };
    }
  }
  return undefined;
}

const SIMPLE_IDENTIFIER = /^[A-Za-z_]\w*$/;

/**
 * Blanks out string literals and comments, and replaces each delimited identifier with its decoded
 * name when that is a simple identifier ([N1 §8.6](https://hl7.org/fhirpath/N1/#identifiers):
 * delimited identifiers use the string escapes). Other delimited identifiers are blanked out; no
 * STU function or variable has such a name.
 */
function prepareForScan(expression: string): string {
  return expression.replace(
    /'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (token) => {
      if (!token.startsWith('`')) {
        return ' ';
      }
      const name = decodeEscapes(token.slice(1, -1));
      return SIMPLE_IDENTIFIER.test(name) ? name : ' ';
    },
  );
}

/** Compares dotted version numbers: negative, zero or positive. */
function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function stu(what: string, task: string | undefined): Classification {
  return { phase: 'stu', reason: task === undefined ? what : `${what} (${task})`, task };
}

function unsupported(reason: string | undefined): Classification {
  return { phase: 'unsupported', reason, task: undefined };
}
