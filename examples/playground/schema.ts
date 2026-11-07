/** JSON-only example data shared by the public-API tests and browser playground. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Expectations describe the declared public output mode, not conformance-suite types. */
export type ExpectedOutcome =
  | { readonly kind: 'result'; readonly value: readonly JsonValue[] }
  | { readonly kind: 'error'; readonly phase: 'json' }
  | { readonly kind: 'error'; readonly phase: 'expression'; readonly code: string };

/** One synthetic teaching case; no callbacks, internal engine values or executable test code. */
export interface ExampleCase {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly narrative: string;
  readonly question: string;
  readonly inputText: string;
  readonly expression: string;
  readonly expected: ExpectedOutcome;
  readonly explanation: string;
  readonly edgeCases: readonly string[];
  readonly tags: readonly string[];
  readonly source: {
    readonly path: string;
    readonly revision: string;
    readonly test: string;
    readonly license: 'MIT';
    readonly note: string;
  };
  readonly requires: {
    readonly functions: readonly ('where' | 'exists' | 'count')[];
    readonly model: 'none';
  };
}

/** All examples use the same deterministic public options as the playground. */
export const exampleOptions: { readonly decimalOutput: 'string'; readonly timezoneOffset: 0 } = {
  decimalOutput: 'string',
  timezoneOffset: 0,
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function texts(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(text);
}

function keys(value: Record<string, unknown>, allowed: string): boolean {
  return Object.keys(value).every((key) => allowed.split(' ').includes(key));
}

function json(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(json);
  return record(value) && Object.values(value).every(json);
}

function expectation(value: unknown): value is ExpectedOutcome {
  if (!record(value)) return false;
  if (value.kind === 'result')
    return keys(value, 'kind value') && Array.isArray(value.value) && value.value.every(json);
  if (value.kind !== 'error') return false;
  if (value.phase === 'json') return keys(value, 'kind phase');
  return (
    value.phase === 'expression' &&
    keys(value, 'kind phase code') &&
    typeof value.code === 'string' &&
    /^(syntax|semantic|eval)\/[a-z][a-z-]*$/.test(value.code)
  );
}

function example(value: unknown): value is ExampleCase {
  if (
    !record(value) ||
    !keys(
      value,
      'id title summary narrative question inputText expression expected explanation edgeCases tags source requires',
    )
  )
    return false;
  if (!text(value.id) || !/^[a-z][a-z0-9-]*$/.test(value.id)) return false;
  if (![value.title, value.summary, value.narrative, value.question, value.explanation].every(text))
    return false;
  if (
    typeof value.inputText !== 'string' ||
    typeof value.expression !== 'string' ||
    !expectation(value.expected)
  )
    return false;
  if (!texts(value.edgeCases) || !texts(value.tags) || value.tags.length === 0) return false;
  const source = value.source;
  if (
    !record(source) ||
    !keys(source, 'path revision test license note') ||
    source.license !== 'MIT' ||
    !text(source.test) ||
    !text(source.note)
  )
    return false;
  if (
    typeof source.path !== 'string' ||
    !/^(apps\/site|packages\/core)\/[\w/.-]+$/.test(source.path) ||
    source.path.includes('..')
  )
    return false;
  if (typeof source.revision !== 'string' || !/^[a-f0-9]{40}$/.test(source.revision)) return false;
  const requires = value.requires;
  return (
    record(requires) &&
    keys(requires, 'functions model') &&
    requires.model === 'none' &&
    texts(requires.functions) &&
    requires.functions.every((name) => ['where', 'exists', 'count'].includes(name)) &&
    new Set(requires.functions).size === requires.functions.length
  );
}

/** Validate the small versioned data contract, including stable unique IDs. */
export function readExamples(value: unknown): readonly ExampleCase[] {
  if (
    !record(value) ||
    !keys(value, 'schemaVersion cases') ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.cases) ||
    value.cases.length === 0 ||
    !value.cases.every(example)
  )
    throw new Error('Invalid playground example library.');
  if (new Set(value.cases.map((item) => item.id)).size !== value.cases.length)
    throw new Error('Duplicate playground example ID.');
  return value.cases;
}

/** Local picker search over authored metadata; never send user input to a search service. */
export function searchExamples(
  examples: readonly ExampleCase[],
  query: string,
): readonly ExampleCase[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return examples.filter((item) => {
    const haystack = [item.title, item.summary, item.question, ...item.tags]
      .join(' ')
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
