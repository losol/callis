import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  adaTwice,
  containerReference,
  exactDecimal,
  expressionError,
  filteredGiven,
  filteredNameCount,
  firstGiven,
  firstTwoGiven,
  given,
  hasAda,
  inHours,
  lastGiven,
  laterGiven,
  lossless,
  managedBy,
  named,
  numberOfNames,
  onlyName,
  parsedDecimal,
  patient,
  quantityJson,
  selectedGiven,
  variable,
  withGrace,
  withoutAda,
} from '../../../examples/public-api.ts';

describe('public guide examples', () => {
  it('runs the quick start, exact rendering and error examples', () => {
    expect(given).toEqual(['Ada', 'Mina']);
    expect(firstGiven).toEqual(['Ada']);
    expect(filteredGiven).toEqual(['Ada', 'Mina']);
    expect(numberOfNames).toEqual([1]);
    expect(hasAda).toEqual([true]);
    expect(filteredNameCount).toEqual([1]);
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
 * A problem with a documented `ts` block. A block starts with an import line for the names from
 * `@callis/core` that it uses, so a reader can copy it; a later block on the same page may use what
 * an earlier one imports. The code after the imports must be part of the executable example. The
 * example itself has one import line with every name, because Biome merges imports from one module.
 */
interface SnippetProblem {
  /** The block, counted from 1 on its page. */
  readonly block: number;
  /**
   * - `not-in-example`: the code after the imports is not part of the example.
   * - `unsupported-import`: an import after other code, or one that is not `import { a, b } from`.
   * - `other-module`: an import from a module other than `@callis/core`.
   * - `not-in-example-import`: a name that the example does not import, so nothing checks that
   *   `@callis/core` exports it.
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
  'other-module': 'documented snippets import only from @callis/core',
  'not-in-example-import': 'examples/public-api.ts does not import it',
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
  const exampleNames = new Set(
    [...example.matchAll(/^import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'@callis\/core';?$/gm)]
      .flatMap((match) => importedNames(match[1] ?? ''))
      .filter((name) => name !== undefined),
  );
  const imported = new Set<string>();
  const problems: SnippetProblem[] = [];
  for (const [index, code] of blocks.entries()) {
    const block = index + 1;
    const blockImports = new Set<string>();
    let body = code;
    for (let match = LEADING_IMPORT.exec(body); match; match = LEADING_IMPORT.exec(body)) {
      body = body.slice(match[0].length);
      const source = match[3] ?? '';
      if (source !== '@callis/core') {
        problems.push({ block, kind: 'other-module', name: source });
        continue;
      }
      for (const name of importedNames(match[1] ?? '')) {
        if (name === undefined) {
          problems.push({ block, kind: 'unsupported-import' });
        } else if (!exampleNames.has(name)) {
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
