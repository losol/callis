/**
 * Converts FHIR XML to FHIR JSON with the generated FHIR model (T0023), so that cardinality,
 * choice names and primitive types come from the specification rather than from guesses about
 * the document.
 *
 * - Elements that repeat in the model are arrays, even with one item.
 * - `boolean` values are JSON booleans. `integer`, its subtypes and `decimal` are JSON numbers
 *   written with the exact text of the XML value, so `1.50` and `9.5e2` stay as they are. Other
 *   primitives, including R5 `integer64`, are strings.
 * - The `id` and extensions of a primitive go to `_name`, aligned with nulls when it repeats.
 * - `Element.id` and `Extension.url`, written as attributes in XML, are ordinary properties.
 * - The XHTML `div` of a narrative is a string, copied from the source as written.
 * - A resource gets `resourceType`; contained and nested resources lose their XML wrapper.
 * - Choice elements keep their typed name (`valueQuantity`), which is the same in both formats.
 * - Properties follow the model's element order, with `resourceType` first.
 *
 * Comments are dropped: FHIR JSON has none. Anything the model does not define is an error.
 *
 * @see https://hl7.org/fhir/R4/xml.html
 * @see https://hl7.org/fhir/R4/json.html
 * @see https://hl7.org/fhir/R5/json.html#primitive
 */
import {
  choiceJsonName,
  type ElementInfo,
  type ModelProvider,
  type ModelTypeInfo,
} from '../../../packages/core/src/model/model-provider.ts';
import { isJsonNumber, type JsonObject, type JsonValue, NumberLexeme } from './json-text.ts';
import { readXml, type XmlAttribute, type XmlElement } from './xml-reader.ts';

/** The FHIR namespace, which every FHIR XML element is in. */
export const FHIR_NAMESPACE = 'http://hl7.org/fhir';

/** The XHTML namespace of narrative `div` elements. */
export const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/** XML Schema instance attributes such as `xsi:schemaLocation` are allowed on the root. */
const XSI_NAMESPACE = 'http://www.w3.org/2001/XMLSchema-instance';

/** An XML whitespace run. Other text between FHIR elements is an error. */
const WHITESPACE = /^[ \t\n]*$/;

/** Thrown when a document is not FHIR XML that the model describes. */
export class FhirXmlError extends Error {
  override readonly name: string = 'FhirXmlError';
  /** A stable code such as `fhir-xml/unknown-element`. */
  readonly code: string;
  /** Where the problem is, as a FHIRPath-like path: `Patient.name[1].given[0]`. */
  readonly path: string;

  constructor(code: string, message: string, path: string) {
    super(`${path}: ${message}`);
    this.code = code;
    this.path = path;
  }
}

/**
 * Converts a FHIR XML resource to FHIR JSON. Write it with `stringifyJson()` to keep the numbers
 * as written; read it back with a lossless JSON parser, because `JSON.parse` turns `1.50` into
 * `1.5`.
 *
 * @throws {XmlReadError} when the text is not XML this tool reads.
 * @throws {FhirXmlError} when the XML is not a FHIR resource the model describes.
 */
export function convertFhirXml(xml: string, model: ModelProvider): JsonObject {
  const document = readXml(xml);
  return convertResource({ model, text: document.text }, document.root, undefined);
}

/** What the conversion functions share. */
interface Context {
  readonly model: ModelProvider;
  /** The document text that element offsets point into. */
  readonly text: string;
}

/** One element of a type, as it is found in XML. */
interface ElementMatch {
  readonly element: ElementInfo;
  /** The XML and JSON name: the element name, or for a choice the name with its type. */
  readonly jsonName: string;
  readonly type: ModelTypeInfo;
}

/** A converted element value, and its `_name` extra for a primitive with an id or extensions. */
interface Converted {
  readonly value: JsonValue;
  readonly extra: JsonValue;
}

/**
 * A resource element: the document element (no `parentPath`), or the content of a resource-typed
 * element such as `contained`.
 */
function convertResource(
  ctx: Context,
  node: XmlElement,
  parentPath: string | undefined,
): JsonObject {
  const path = parentPath ?? node.localName;
  if (node.namespace !== FHIR_NAMESPACE) {
    return fail('fhir-xml/namespace', `<${node.name}> is not in the FHIR namespace`, path);
  }
  const type = ctx.model.getType(node.localName);
  if (type === undefined || type.kind !== 'resource' || type.isAbstract) {
    return fail('fhir-xml/unknown-resource', `${node.localName} is not a resource type`, path);
  }
  // xsi:schemaLocation and the like may decorate the document element.
  const attributes = node.attributes.filter(
    (attribute) => !(parentPath === undefined && attribute.namespace === XSI_NAMESPACE),
  );
  return new Map([
    ['resourceType', type.name],
    ...convertProperties(ctx, node, type, attributes, path),
  ]);
}

/** The properties of a resource, a complex value, or the `id` and extensions of a primitive. */
function convertProperties(
  ctx: Context,
  node: XmlElement,
  type: ModelTypeInfo,
  attributes: readonly XmlAttribute[],
  path: string,
): Map<string, JsonValue> {
  // https://hl7.org/fhir/R4/xml.html#xml: Element.id and Extension.url are attributes.
  const fromAttributes = new Map<ElementInfo, string>();
  for (const attribute of attributes) {
    const element = attributeElement(ctx, type, attribute);
    if (element === undefined) {
      fail('fhir-xml/unexpected-attribute', `unexpected attribute ${attribute.name}`, path);
    }
    fromAttributes.set(element, attribute.value);
  }

  const groups = new Map<
    ElementInfo,
    { readonly match: ElementMatch; readonly nodes: XmlElement[] }
  >();
  for (const child of node.children) {
    if (child.kind === 'text') {
      if (!WHITESPACE.test(child.text)) {
        fail('fhir-xml/unexpected-text', 'text is only allowed in XHTML', path);
      }
      continue;
    }
    const match = matchElement(ctx, type, child, path);
    if (fromAttributes.has(match.element)) {
      fail(
        'fhir-xml/duplicate-element',
        `${match.jsonName} is both an attribute and an element`,
        path,
      );
    }
    const group = groups.get(match.element);
    if (group === undefined) {
      groups.set(match.element, { match, nodes: [child] });
    } else if (group.match.jsonName !== match.jsonName) {
      fail(
        'fhir-xml/mixed-choice',
        `${match.element.name}[x] is given as both ${group.match.jsonName} and ${match.jsonName}`,
        path,
      );
    } else {
      group.nodes.push(child);
    }
  }

  const properties = new Map<string, JsonValue>();
  for (const element of ctx.model.getElements(type)) {
    const attributeValue = fromAttributes.get(element);
    if (attributeValue !== undefined) {
      properties.set(element.name, attributeValue);
      continue;
    }
    const group = groups.get(element);
    if (group === undefined) continue;
    const { match, nodes } = group;
    if (!element.isArray && nodes.length > 1) {
      fail('fhir-xml/repeated-element', `${match.jsonName} does not repeat`, path);
    }
    const converted = nodes.map((child, index) =>
      convertValue(
        ctx,
        child,
        match.type,
        `${path}.${match.jsonName}${element.isArray ? `[${index}]` : ''}`,
      ),
    );
    const values = converted.map((item) => item.value);
    const extras = converted.map((item) => item.extra);
    // https://hl7.org/fhir/R4/json.html#primitive: a repeating primitive is two arrays aligned
    // with nulls; a side that is all null is left out.
    if (values.some((value) => value !== null)) {
      properties.set(match.jsonName, element.isArray ? values : (values[0] ?? null));
    }
    if (extras.some((extra) => extra !== null)) {
      properties.set(`_${match.jsonName}`, element.isArray ? extras : (extras[0] ?? null));
    }
  }
  return properties;
}

/** The element an XML attribute stands for: `id` on a non-resource element, `url` on an extension. */
function attributeElement(
  ctx: Context,
  type: ModelTypeInfo,
  attribute: XmlAttribute,
): ElementInfo | undefined {
  if (attribute.namespace !== undefined) return undefined;
  const extension = ctx.model.getType('Extension');
  const isAttribute =
    (attribute.name === 'id' && type.kind !== 'resource') ||
    (attribute.name === 'url' && extension !== undefined && ctx.model.isSubtypeOf(type, extension));
  return isAttribute ? ctx.model.getElement(type, attribute.name) : undefined;
}

/** Finds the element of `type` that an XML child element stands for. */
function matchElement(
  ctx: Context,
  type: ModelTypeInfo,
  child: XmlElement,
  path: string,
): ElementMatch {
  const isXhtml = child.namespace === XHTML_NAMESPACE;
  if (!isXhtml && child.namespace !== FHIR_NAMESPACE) {
    fail('fhir-xml/namespace', `<${child.name}> is not in the FHIR namespace`, path);
  }
  for (const element of ctx.model.getElements(type)) {
    for (const typeName of element.typeNames) {
      const jsonName = element.isChoice ? choiceJsonName(element.name, typeName) : element.name;
      if (jsonName !== child.localName) continue;
      const elementType = ctx.model.getType(typeName);
      if (elementType === undefined) {
        return fail('fhir-xml/unknown-type', `the model has no type ${typeName}`, path);
      }
      // An xhtml element is always written in the XHTML namespace, and nothing else is.
      if (isXhtml !== (elementType.name === 'xhtml')) {
        return fail('fhir-xml/namespace', `<${child.name}> is in the wrong namespace`, path);
      }
      return { element, jsonName, type: elementType };
    }
  }
  return fail('fhir-xml/unknown-element', `${type.name} has no element ${child.localName}`, path);
}

/** Converts the XML of one element value. */
function convertValue(
  ctx: Context,
  node: XmlElement,
  type: ModelTypeInfo,
  path: string,
): Converted {
  if (type.name === 'xhtml') {
    return { value: convertXhtml(ctx, node, path), extra: null };
  }
  if (type.kind === 'primitive') {
    return convertPrimitive(ctx, node, type, path);
  }
  if (type.kind === 'resource') {
    return { value: convertWrappedResource(ctx, node, path), extra: null };
  }
  const properties = convertProperties(ctx, node, type, node.attributes, path);
  if (properties.size === 0) {
    fail('fhir-xml/empty-element', `${node.localName} has no content`, path);
  }
  return { value: properties, extra: null };
}

/**
 * A primitive: the `value` attribute is the value; `id` and extensions are the `_name` extra.
 *
 * @see https://hl7.org/fhir/R4/json.html#primitive
 */
function convertPrimitive(
  ctx: Context,
  node: XmlElement,
  type: ModelTypeInfo,
  path: string,
): Converted {
  const valueAttribute = node.attributes.find(
    (attribute) => attribute.name === 'value' && attribute.namespace === undefined,
  );
  const others = node.attributes.filter((attribute) => attribute !== valueAttribute);
  const extra = convertProperties(ctx, node, type, others, path);
  if (valueAttribute === undefined && extra.size === 0) {
    fail('fhir-xml/empty-element', `${node.localName} has no value, id or extension`, path);
  }
  return {
    value:
      valueAttribute === undefined ? null : primitiveValue(ctx, valueAttribute.value, type, path),
    extra: extra.size === 0 ? null : extra,
  };
}

function primitiveValue(ctx: Context, text: string, type: ModelTypeInfo, path: string): JsonValue {
  // https://hl7.org/fhir/R4/datatypes.html#primitive: a value is never empty.
  if (text === '') {
    return fail('fhir-xml/invalid-value', 'a primitive value may not be empty', path);
  }
  switch (ctx.model.getSystemType(type)) {
    case 'Boolean':
      if (text !== 'true' && text !== 'false') {
        return fail('fhir-xml/invalid-value', `${text} is not a boolean`, path);
      }
      return text === 'true';
    // An integer or decimal lexeme is written as the JSON number it already is. A FHIR lexeme
    // that JSON cannot hold (a leading "+") is refused rather than rewritten.
    case 'Integer':
      if (!/^-?(?:0|[1-9]\d*)$/.test(text)) {
        return fail('fhir-xml/invalid-value', `${text} is not an integer JSON can hold`, path);
      }
      return new NumberLexeme(text);
    case 'Decimal':
      if (!isJsonNumber(text)) {
        return fail('fhir-xml/invalid-value', `${text} is not a decimal JSON can hold`, path);
      }
      return new NumberLexeme(text);
    default:
      // Strings, dates, codes and the like, and R5 integer64, which JSON writes as a string
      // (https://hl7.org/fhir/R5/json.html#primitive).
      return text;
  }
}

/**
 * The narrative `div`, as a string. It is copied from the source, so the XHTML stays as it was
 * written, with its references, as in the official JSON examples.
 *
 * @see https://hl7.org/fhir/R4/narrative.html#xhtml
 */
function convertXhtml(ctx: Context, node: XmlElement, path: string): string {
  if (node.name !== 'div' || node.declarations.get('') !== XHTML_NAMESPACE) {
    fail(
      'fhir-xml/invalid-xhtml',
      'a narrative must be a <div> that declares xmlns="http://www.w3.org/1999/xhtml"',
      path,
    );
  }
  if (usesPrefix(node)) {
    // A copied fragment must not depend on prefixes declared outside it.
    fail('fhir-xml/invalid-xhtml', 'XHTML with namespace prefixes is not supported', path);
  }
  return ctx.text.slice(node.start, node.end);
}

function usesPrefix(element: XmlElement): boolean {
  return (
    element.name.includes(':') ||
    element.attributes.some(
      (attribute) => attribute.name.includes(':') && !attribute.name.startsWith('xml:'),
    ) ||
    element.children.some((child) => child.kind === 'element' && usesPrefix(child))
  );
}

/** A resource-typed element (`contained`, `Bundle.entry.resource`): one resource inside. */
function convertWrappedResource(ctx: Context, node: XmlElement, path: string): JsonObject {
  if (node.attributes.length > 0) {
    fail('fhir-xml/unexpected-attribute', `<${node.name}> takes no attributes`, path);
  }
  const elements: XmlElement[] = [];
  for (const child of node.children) {
    if (child.kind === 'element') {
      elements.push(child);
    } else if (!WHITESPACE.test(child.text)) {
      fail('fhir-xml/unexpected-text', 'text is only allowed in XHTML', path);
    }
  }
  const [inner] = elements;
  if (inner === undefined || elements.length > 1) {
    return fail('fhir-xml/invalid-resource', `<${node.name}> must hold exactly one resource`, path);
  }
  return convertResource(ctx, inner, path);
}

function fail(code: string, message: string, path: string): never {
  throw new FhirXmlError(code, message, path);
}
