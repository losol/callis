/**
 * The host hooks the runner passes to the engine
 * ([T0021](../../../docs/tasks/T0021-hooks-async.md#acceptance-criteria)): fakes that answer what
 * the suites' tests ask, so the hook-backed functions are measured like the others instead of
 * being reported as "not implemented". They are fixtures for the HL7 suites, not implementations:
 * a host plugs in a validator, a terminology server and an HTML checker.
 *
 * - `conformsTo` knows the base profiles of the suite model's resource types,
 *   `http://hl7.org/fhir/StructureDefinition/[Type]`, and answers whether the value is a
 *   resource of that type. Any other profile cannot be resolved, which the R4 text and both
 *   suites (`testConformsTo3`) treat as an execution error, so it throws `eval/invalid-argument`
 *   ([spec notes](../../../docs/spec-notes.md#hook-backed-functions-errors-and-empty-results)).
 * - `htmlChecks` checks the element names against the elements FHIR allows in a narrative
 *   ([Narrative](https://hl7.org/fhir/R5/narrative.html#xhtml); the list is the one the HL7 Java
 *   engine checks), and for an `xhtml` element that the root is a `div`. It does not check
 *   attributes or well-formedness, which no suite test needs.
 * - There is no terminology provider: no suite test calls `memberOf()`, `subsumes()` or
 *   `subsumedBy()` (the `TerminologyTests` group uses `%terminologies`, T0032), so they stay
 *   empty.
 *
 * The fakes answer through promises, so the suites measure the asynchronous path.
 */
import { FhirPathEvaluationError } from '../../../packages/core/src/errors/fhirpath-error.ts';
import type { ModelProvider } from '../../../packages/core/src/model/model-provider.ts';
import type { EvaluationHooks } from '../../../packages/core/src/runtime/hooks.ts';

/** A base profile: the canonical URL of a resource type's StructureDefinition. */
const BASE_PROFILE = /^http:\/\/hl7\.org\/fhir\/StructureDefinition\/([A-Z][A-Za-z0-9]*)$/;

/** The elements a narrative may use. */
const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  'p',
  'br',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'span',
  'b',
  'em',
  'i',
  'strong',
  'small',
  'big',
  'tt',
  'dfn',
  'q',
  'var',
  'abbr',
  'acronym',
  'cite',
  'blockquote',
  'hr',
  'address',
  'bdo',
  'kbd',
  'sub',
  'sup',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'pre',
  'table',
  'caption',
  'colgroup',
  'col',
  'thead',
  'tr',
  'tfoot',
  'tbody',
  'th',
  'td',
  'code',
  'samp',
  'img',
  'map',
  'area',
]);

/** An opening, closing or empty tag, with its element name. */
const TAG = /<\/?([A-Za-z][A-Za-z0-9]*)(?:\s[^>]*)?\/?>/g;

/**
 * Whether the HTML uses allowed elements only, and for `xhtml` has a `div` as its root.
 *
 * @param kind - What the text is: the `xhtml` element itself, or a string that is the content
 *   of a `div`.
 */
export function checkHtml(html: string, kind: 'xhtml' | 'string'): boolean {
  if (kind === 'xhtml' && !/^\s*<div[\s>]/.test(html)) {
    return false;
  }
  for (const match of html.matchAll(TAG)) {
    const name = match[1]?.toLowerCase();
    if (name === undefined || !ALLOWED_ELEMENTS.has(name)) {
      return false;
    }
  }
  return true;
}

/**
 * Whether the value is a resource of the type that the base profile names, as the suite model
 * knows it.
 *
 * @throws {@link FhirPathEvaluationError} `eval/invalid-argument` for a profile that is not a
 *   base profile of a resource type of the model.
 */
export function checkProfile(model: ModelProvider, value: unknown, profile: string): boolean {
  const name = BASE_PROFILE.exec(profile)?.[1];
  const type = name === undefined ? undefined : model.getType(name);
  if (type === undefined || type.kind !== 'resource') {
    throw new FhirPathEvaluationError(
      'eval/invalid-argument',
      'The profile cannot be resolved to a structure definition',
    );
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const actual = model.getRootType(value);
  return actual !== undefined && model.isSubtypeOf(actual, type);
}

/** The fake hooks for a suite, with the model of its FHIR version. */
export function fakeHooks(model: ModelProvider): EvaluationHooks {
  return {
    conformsTo: (value, profile) => Promise.resolve(checkProfile(model, value, profile)),
    htmlChecks: (html, context) => Promise.resolve(checkHtml(html, context.kind)),
  };
}
