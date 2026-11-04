import { XMLParser } from 'fast-xml-parser';
import type {
  ExpectedOutput,
  InvalidKind,
  OutputType,
  SuiteGroup,
  SuiteId,
  SuiteTest,
  TestSuite,
} from './suite.ts';

const OUTPUT_TYPES: ReadonlySet<string> = new Set<OutputType>([
  'boolean',
  'integer',
  'decimal',
  'string',
  'date',
  'dateTime',
  'time',
  'code',
  'id',
  'Quantity',
]);

const INVALID_KINDS: ReadonlySet<string> = new Set<InvalidKind>([
  'syntax',
  'semantic',
  'execution',
  'true',
]);

const REPEATED_ELEMENTS: ReadonlySet<string> = new Set(['group', 'test', 'output']);

// Typed as `Symbol` (the wrapper object) by fast-xml-parser; it is a symbol at run time.
const META: unknown = XMLParser.getMetaDataSymbol();

/** An XML element as fast-xml-parser returns it with the options below. */
type XmlNode = Readonly<Record<string, unknown>>;

/**
 * Parses an HL7 FHIRPath test file (`tests-fhir-r4.xml` or `tests-fhir-r5.xml`).
 *
 * Throws an `Error` naming the test when the file does not match the test schema.
 */
export function parseSuite(xml: string, id: SuiteId, fileName: string): TestSuite {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    attributesGroupName: '@',
    textNodeName: '#text',
    alwaysCreateTextNode: true,
    trimValues: false,
    parseTagValue: false,
    parseAttributeValue: false,
    processEntities: true,
    htmlEntities: false,
    captureMetaData: true,
    isArray: (name) => REPEATED_ELEMENTS.has(name),
  });
  const document: unknown = parser.parse(xml);
  const root = isNode(document) ? child(document, 'tests') : undefined;
  if (root === undefined) {
    throw new Error(`${fileName}: missing <tests> root element`);
  }
  const lines = lineIndex(xml);
  const seen = new Map<string, number>();
  const groups = children(root, 'group').map((group): SuiteGroup => {
    const name = requiredAttribute(group, 'name', `${fileName}: <group>`);
    const mode = attribute(group, 'mode');
    const tests = children(group, 'test').map((test) =>
      parseTest(test, { fileName, group: name, groupMode: mode, lines, seen }),
    );
    return { name, description: attribute(group, 'description'), mode, tests };
  });
  return { id, fileName, groups };
}

interface TestContext {
  readonly fileName: string;
  readonly group: string;
  readonly groupMode: string | undefined;
  readonly lines: readonly number[];
  /** How often each test name has been seen so far, for unique IDs. */
  readonly seen: Map<string, number>;
}

function parseTest(test: XmlNode, ctx: TestContext): SuiteTest {
  const name = requiredAttribute(test, 'name', `${ctx.fileName}: <test> in ${ctx.group}`);
  const where = `${ctx.fileName}: test ${name}`;
  const expression = child(test, 'expression');
  if (expression === undefined) {
    throw new Error(`${where}: missing <expression>`);
  }
  const count = (ctx.seen.get(name) ?? 0) + 1;
  ctx.seen.set(name, count);
  const contextType = attribute(test, 'contextType');
  return {
    id: count === 1 ? name : `${name}#${count}`,
    name,
    group: ctx.group,
    line: lineOf(ctx.lines, startIndex(test)),
    description: attribute(test, 'description'),
    testing: attribute(test, 'testing'),
    expression: text(expression).trim(),
    invalid: parseInvalid(attribute(expression, 'invalid'), where),
    outputs: children(test, 'output').map((output) => parseOutput(output, where)),
    inputFile: attribute(test, 'inputfile'),
    mode: attribute(test, 'mode') ?? attribute(expression, 'mode') ?? ctx.groupMode,
    predicate: booleanAttribute(test, 'predicate', where) ?? false,
    ordered: booleanAttribute(test, 'ordered', where),
    checkOrderedFunctions:
      booleanAttribute(test, 'checkOrderedFunctions', where) ??
      booleanAttribute(test, 'ordered', where) ??
      false,
    context: attribute(test, 'context'),
    contextTypes: contextType === undefined ? [] : contextType.split('|').map((t) => t.trim()),
    version: attribute(test, 'version'),
    skipStaticCheck: booleanAttribute(test, 'skipStaticCheck', where) ?? false,
  };
}

function parseInvalid(value: string | undefined, where: string): InvalidKind | undefined {
  if (value === undefined || value === 'false') {
    return undefined;
  }
  if (!isInvalidKind(value)) {
    throw new Error(`${where}: unknown invalid="${value}"`);
  }
  return value;
}

function parseOutput(output: XmlNode, where: string): ExpectedOutput {
  const type = attribute(output, 'type');
  if (type === undefined) {
    return { type: undefined, text: text(output) };
  }
  if (!isOutputType(type)) {
    throw new Error(`${where}: unknown output type "${type}"`);
  }
  return { type, text: text(output) };
}

function isOutputType(value: string): value is OutputType {
  return OUTPUT_TYPES.has(value);
}

function isInvalidKind(value: string): value is InvalidKind {
  return INVALID_KINDS.has(value);
}

function isNode(value: unknown): value is XmlNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function child(node: XmlNode, name: string): XmlNode | undefined {
  const value = Object.hasOwn(node, name) ? node[name] : undefined;
  return isNode(value) ? value : undefined;
}

function children(node: XmlNode, name: string): XmlNode[] {
  const value = Object.hasOwn(node, name) ? node[name] : undefined;
  return Array.isArray(value) ? value.filter(isNode) : [];
}

function attribute(node: XmlNode, name: string): string | undefined {
  const attributes = child(node, '@');
  if (attributes === undefined || !Object.hasOwn(attributes, name)) {
    return undefined;
  }
  const value = attributes[name];
  return typeof value === 'string' ? value : undefined;
}

function requiredAttribute(node: XmlNode, name: string, where: string): string {
  const value = attribute(node, name);
  if (value === undefined || value === '') {
    throw new Error(`${where}: missing ${name} attribute`);
  }
  return value;
}

function booleanAttribute(node: XmlNode, name: string, where: string): boolean | undefined {
  const value = attribute(node, name);
  if (value === undefined) {
    return undefined;
  }
  if (value !== 'true' && value !== 'false') {
    throw new Error(`${where}: ${name}="${value}" is not a boolean`);
  }
  return value === 'true';
}

function text(node: XmlNode): string {
  const value = Object.hasOwn(node, '#text') ? node['#text'] : '';
  if (Array.isArray(value)) {
    return value.join('');
  }
  return typeof value === 'string' ? value : '';
}

function startIndex(node: XmlNode): number {
  if (typeof META !== 'symbol') {
    return 0;
  }
  const meta: unknown = Reflect.get(node, META);
  if (typeof meta === 'object' && meta !== null && 'startIndex' in meta) {
    const index = meta.startIndex;
    return typeof index === 'number' ? index : 0;
  }
  return 0;
}

/** Offsets at which each line starts. */
function lineIndex(source: string): number[] {
  const starts = [0];
  for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1)) {
    starts.push(i + 1);
  }
  return starts;
}

/** The 1-based line containing `offset`. */
function lineOf(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low + 1;
}
