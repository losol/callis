import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  adaTwice,
  addedDay,
  alertLabel,
  allGiven,
  birthTime,
  containerReference,
  deceased,
  elementDiagnostics,
  exactDecimal,
  expressionError,
  filteredGiven,
  filteredNameCount,
  firstGiven,
  firstGivenPerName,
  firstTwoGiven,
  fractionDiagnostics,
  given,
  givenDistinct,
  hasAda,
  inHours,
  knownGiven,
  lastGiven,
  laterGiven,
  linkIds,
  lossless,
  managedBy,
  named,
  noNames,
  numberOfNames,
  onlyName,
  onlyPatients,
  parsedDecimal,
  patient,
  quantityJson,
  selectedGiven,
  someFalse,
  strictCode,
  suffixedUnit,
  uniqueGiven,
  unknownFunction,
  variable,
  withGrace,
  withoutAda,
} from '../../../examples/public-api.ts';

describe('public guide examples', () => {
  // docs/tasks/T0038a-public-model-options.md
  it('runs the FHIR model examples', () => {
    expect(deceased).toEqual([false]);
    expect(birthTime).toEqual(['1974-12-25T14:35:45-05:00']);
    expect(elementDiagnostics).toEqual([
      expect.objectContaining({ severity: 'error', code: 'semantic/unknown-element' }),
    ]);
    expect(suffixedUnit).toEqual(['lbs']);
    expect(alertLabel).toEqual(['SpO2 low']);
  });

  it('runs the quick start, exact rendering and error examples', () => {
    expect(given).toEqual(['Ada', 'Mina']);
    expect(firstGiven).toEqual(['Ada']);
    expect(filteredGiven).toEqual(['Ada', 'Mina']);
    expect(firstGivenPerName).toEqual(['Ada']);
    expect(linkIds).toEqual(['1', '2', '1.1', '1.2']);
    expect(onlyPatients).toEqual([patient]);
    expect(onlyPatients[0]).toBe(patient);
    expect(numberOfNames).toEqual([1]);
    expect(hasAda).toEqual([true]);
    expect(filteredNameCount).toEqual([1]);
    expect(noNames).toEqual([false]);
    expect(allGiven).toEqual([true]);
    expect(someFalse).toEqual([true]);
    expect(knownGiven).toEqual([true]);
    expect(uniqueGiven).toEqual(['Mina', 'Ada']);
    expect(givenDistinct).toEqual([true]);
    expect(selectedGiven).toEqual(['Ada']);
    expect(onlyName).toEqual(patient.name);
    expect(onlyName[0]).toBe(patient.name[0]);
    expect(lastGiven).toEqual(['Mina']);
    expect(laterGiven).toEqual(['Mina']);
    expect(firstTwoGiven).toEqual(['Ada', 'Mina']);
    expect(withoutAda).toEqual(['Mina']);
    expect(withGrace).toEqual(['Ada', 'Mina', 'Grace']);
    expect(adaTwice).toEqual(['Ada', 'Ada']);
    expect(named).toEqual(['named']);
    expect(parsedDecimal).toEqual(['1.50']);
    expect(inHours).toEqual(["96 'h'"]);
    expect(exactDecimal).toEqual(['9007199254740993.1200']);
    expect(quantityJson).toBe(
      '[{"value":"1.200","unit":"mg","system":"http://unitsofmeasure.org","code":"mg"}]',
    );
    expect(variable).toEqual(['hello']);
    expect(lossless).toEqual(['1.50']);
    expect(managedBy).toEqual(['Acme']);
    expect(containerReference).toEqual(['#o1']);
    expect(expressionError()).toContain('syntax/unexpected-token');
    expect(fractionDiagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'semantic/fraction-ignored' }),
    ]);
    expect(unknownFunction).toEqual([
      expect.objectContaining({ severity: 'error', code: 'semantic/unknown-function' }),
    ]);
    expect(addedDay).toEqual(['2020-01-02']);
    expect(strictCode('(1 | 2) < 3')).toBe('semantic/singleton-expected');
    expect(strictCode('children().first()')).toBe('semantic/unordered-collection');
    expect(strictCode('name.given < 3')).toBe('');
  });

  it('keeps every documented TypeScript snippet in the executable example, with its own imports', () => {
    const root = new URL('../../../', import.meta.url);
    const example = readFileSync(new URL('examples/public-api.ts', root), 'utf8');
    for (const path of DOCUMENTED_PAGES) {
      const text = readFileSync(new URL(path, root), 'utf8');
      const blocks = [...text.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1] ?? '');
      expect(blocks.length, path).toBeGreaterThan(0);
      expect(
        checkPage(blocks, example).map((problem) =>
          formatProblem(fileURLToPath(new URL(path, root)), problem),
        ),
      ).toEqual([]);
    }
  });
});

describe('checking the documented snippets', () => {
  const example = [
    "import { compile, evaluate, FhirPathError } from '@callis/core';",
    "export const one: unknown[] = evaluate(null, '1');",
    "export const two: unknown[] = compile('2').evaluate(null);",
    'export const quoted: unknown[] = evaluate(null, "\'compile\'");',
    'export const errors: FhirPathError[] = [];',
  ].join('\n');

  /** The kind and name of each problem, so tests do not depend on the message text. */
  function problemsOf(...blocks: string[]): [number, SnippetProblem['kind'], string?][] {
    return checkPage(blocks, example).map(
      ({ block, kind, name }): [number, SnippetProblem['kind'], string?] =>
        name === undefined ? [block, kind] : [block, kind, name],
    );
  }

  it('accepts blocks that import the names they use, and later blocks that use them', () => {
    expect(
      problemsOf(
        "import { evaluate } from '@callis/core';\nexport const one: unknown[] = evaluate(null, '1');",
        "import { compile } from '@callis/core';\nexport const two: unknown[] = compile('2').evaluate(null);",
        "export const one: unknown[] = evaluate(null, '1');",
      ),
    ).toEqual([]);
  });

  it('reports a name that the block imports but does not use', () => {
    expect(
      problemsOf(
        "import { compile, evaluate } from '@callis/core';\nexport const one: unknown[] = evaluate(null, '1');",
      ),
    ).toEqual([[1, 'unused-import', 'compile']]);
  });

  it('reports a name that no block up to this one imports', () => {
    expect(
      problemsOf(
        "export const one: unknown[] = evaluate(null, '1');",
        "import { evaluate } from '@callis/core';\nexport const one: unknown[] = evaluate(null, '1');",
      ),
    ).toEqual([[1, 'missing-import', 'evaluate']]);
  });

  it('counts neither a method nor a string as a use of an imported name', () => {
    expect(
      problemsOf(
        "import { compile } from '@callis/core';\nexport const two: unknown[] = compile('2').evaluate(null);",
        "import { evaluate } from '@callis/core';\nexport const quoted: unknown[] = evaluate(null, \"'compile'\");",
      ),
    ).toEqual([]);
  });

  it('counts a name in a type annotation as a use', () => {
    expect(problemsOf('export const errors: FhirPathError[] = [];')).toEqual([
      [1, 'missing-import', 'FhirPathError'],
    ]);
  });

  it('reports a name that the example does not import', () => {
    expect(
      problemsOf(
        "import { evaluate, parseJson } from '@callis/core';\nexport const one: unknown[] = evaluate(null, '1');",
      ),
    ).toEqual([[1, 'not-in-example-import', 'parseJson']]);
  });

  it('accepts imports from the provider packages that the example imports', () => {
    const withModel = `${example}\nimport { r4 } from '@callis/fhir-r4';\nexport const model: unknown = r4;`;
    expect(
      checkPage(
        [
          "import { r4 } from '@callis/fhir-r4';\nexport const model: unknown = r4;",
          "import { r5 } from '@callis/fhir-r5';\nexport const model: unknown = r5;",
        ],
        withModel,
      ).map(({ block, kind, name }) => [block, kind, name]),
    ).toEqual([
      [2, 'not-in-example-import', 'r5'],
      [2, 'not-in-example', undefined],
    ]);
  });

  it('reports a name that the block imports from another package than the example', () => {
    const withModel = `${example}\nimport { r4 } from '@callis/fhir-r4';\nexport const model: unknown = r4;`;
    expect(
      checkPage(
        [
          "import { r4 } from '@callis/fhir-r5';\nexport const model: unknown = r4;",
          "import { evaluate } from '@callis/fhir-r4';\nexport const one: unknown[] = evaluate(null, '1');",
        ],
        withModel,
      ).map(({ block, kind, name }) => [block, kind, name]),
    ).toEqual([
      [1, 'not-in-example-import', 'r4'],
      [1, 'missing-import', 'r4'],
      [2, 'not-in-example-import', 'evaluate'],
      [2, 'missing-import', 'evaluate'],
    ]);
  });

  it('reports an import from another module', () => {
    expect(
      problemsOf(
        "import { evaluate } from 'callis';\nexport const one: unknown[] = evaluate(null, '1');",
      ),
    ).toEqual([
      [1, 'other-module', 'callis'],
      [1, 'missing-import', 'evaluate'],
    ]);
  });

  it.each([
    [
      'after other code',
      "export const one: unknown[] = evaluate(null, '1');\nimport { evaluate } from '@callis/core';",
    ],
    ['of a whole module', "import * as callis from '@callis/core';"],
    ['with a renamed name', "import { evaluate as run } from '@callis/core';"],
  ])('reports an import it cannot read: %s', (_, block) => {
    expect(problemsOf(block).map(([, kind]) => kind)).toContain('unsupported-import');
  });

  it('reports code that is not part of the example', () => {
    expect(
      problemsOf(
        "import { evaluate } from '@callis/core';\nexport const three: unknown[] = evaluate(null, '3');",
      ),
    ).toEqual([[1, 'not-in-example']]);
  });
});

/** The pages whose `ts` blocks must be part of `examples/public-api.ts`. */
const DOCUMENTED_PAGES = ['README.md', 'packages/core/README.md', 'docs/guide.md'] as const;

/**
 * The packages a documented snippet may import from: the engine, and the model and unit
 * providers that its options take.
 */
const DOCUMENTED_MODULES: ReadonlySet<string> = new Set([
  '@callis/core',
  '@callis/ucum',
  '@callis/fhir-r4',
  '@callis/fhir-r5',
  '@callis/fhir-r6',
]);

/**
 * A problem with a documented `ts` block. A block starts with import lines for the names from the
 * {@link DOCUMENTED_MODULES} that it uses, so a reader can copy it; a later block on the same page
 * may use what an earlier one imports. The code after the imports must be part of the executable
 * example. The example itself has one import line per module with every name, because Biome
 * merges imports from one module.
 */
interface SnippetProblem {
  /** The block, counted from 1 on its page. */
  readonly block: number;
  /**
   * - `not-in-example`: the code after the imports is not part of the example.
   * - `unsupported-import`: an import after other code, or one that is not `import { a, b } from`.
   * - `other-module`: an import from a module that is not one of the {@link DOCUMENTED_MODULES}.
   * - `not-in-example-import`: a name that the example does not import from the same package, so
   *   nothing checks that the package exports it.
   * - `unused-import`: a name that the block imports but does not use.
   * - `missing-import`: a name from the example's import that the block uses, but that neither it
   *   nor an earlier block on the page imports.
   */
  readonly kind:
    | 'not-in-example'
    | 'unsupported-import'
    | 'other-module'
    | 'not-in-example-import'
    | 'unused-import'
    | 'missing-import';
  /** The name or module the problem is about. */
  readonly name?: string;
}

const PROBLEM_TEXT: Readonly<Record<SnippetProblem['kind'], string>> = {
  'not-in-example': 'its code is not part of examples/public-api.ts',
  'unsupported-import': 'put `import { a, b } from …` first in the block, without renaming',
  'other-module': 'documented snippets import only from @callis/core and its provider packages',
  'not-in-example-import': 'examples/public-api.ts does not import it from this package',
  'unused-import': 'the block imports it but does not use it',
  'missing-import': 'the block uses it, but neither it nor an earlier block on the page imports it',
};

/** A problem as a line of the test failure. */
function formatProblem(path: string, { block, kind, name }: SnippetProblem): string {
  return `${path}, ts block ${block}: ${name === undefined ? '' : `${name}: `}${PROBLEM_TEXT[kind]}`;
}

/** A named import at the start of the code: `import { a, type B } from 'module';`. */
const LEADING_IMPORT = /^\s*import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*(['"])([^'"]*)\2\s*;?/;

/** Checks the `ts` blocks of one page, in order, against the executable example. */
function checkPage(blocks: readonly string[], example: string): SnippetProblem[] {
  // The names the example imports, by package, so a block that imports a name from another
  // package than the example does is reported.
  const exampleImports = new Map<string, Set<string>>();
  for (const match of example.matchAll(
    /^import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'([^']*)';?$/gm,
  )) {
    const source = match[2] ?? '';
    if (!DOCUMENTED_MODULES.has(source)) continue;
    const names = exampleImports.get(source) ?? new Set<string>();
    for (const name of importedNames(match[1] ?? '')) {
      if (name !== undefined) names.add(name);
    }
    exampleImports.set(source, names);
  }
  const exampleNames = new Set([...exampleImports.values()].flatMap((names) => [...names]));
  const imported = new Set<string>();
  const problems: SnippetProblem[] = [];
  for (const [index, code] of blocks.entries()) {
    const block = index + 1;
    const blockImports = new Set<string>();
    let body = code;
    for (let match = LEADING_IMPORT.exec(body); match; match = LEADING_IMPORT.exec(body)) {
      body = body.slice(match[0].length);
      const source = match[3] ?? '';
      if (!DOCUMENTED_MODULES.has(source)) {
        problems.push({ block, kind: 'other-module', name: source });
        continue;
      }
      for (const name of importedNames(match[1] ?? '')) {
        if (name === undefined) {
          problems.push({ block, kind: 'unsupported-import' });
        } else if (!exampleImports.get(source)?.has(name)) {
          problems.push({ block, kind: 'not-in-example-import', name });
        } else {
          blockImports.add(name);
        }
      }
    }
    if (/^\s*import\b/m.test(body)) {
      problems.push({ block, kind: 'unsupported-import' });
    } else if (!normalize(example).includes(normalize(body))) {
      problems.push({ block, kind: 'not-in-example' });
    }
    const bodyCode = withoutStringsAndComments(body);
    for (const name of blockImports) {
      if (!usesName(bodyCode, name)) {
        problems.push({ block, kind: 'unused-import', name });
      }
    }
    for (const name of exampleNames) {
      if (usesName(bodyCode, name) && !blockImports.has(name) && !imported.has(name)) {
        problems.push({ block, kind: 'missing-import', name });
      }
    }
    for (const name of blockImports) {
      imported.add(name);
    }
  }
  return problems;
}

/** The local names in the braces of an import; `undefined` for one the check cannot read. */
function importedNames(specifiers: string): (string | undefined)[] {
  return specifiers
    .split(',')
    .map((specifier) => specifier.trim())
    .filter((specifier) => specifier !== '')
    .map((specifier) => /^(?:type\s+)?([A-Za-z_$][\w$]*)$/.exec(specifier)?.[1]);
}

/** Ignores formatting-only whitespace, commas and semicolons in the shared snippets. */
function normalize(code: string): string {
  return code.replace(/[\s,;]/g, '');
}

/** The code with every string literal and comment blanked, so a name in one is not a use. */
function withoutStringsAndComments(code: string): string {
  return code.replace(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g,
    ' ',
  );
}

/** Whether the code refers to the name itself, not to a property or method of that name. */
function usesName(code: string, name: string): boolean {
  return new RegExp(`(?<![\\w$.])${name.replaceAll('$', '\\$')}(?![\\w$])`).test(code);
}
