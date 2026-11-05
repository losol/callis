/**
 * A small, strict XML 1.0 reader for the FHIR XML inputs of the HL7 suite (T0023).
 *
 * It reads elements, attributes, text, CDATA sections, comments and processing instructions, and
 * resolves namespaces. It keeps each element's place in the source text, so the converter can copy
 * an XHTML narrative as written. It does not read DTDs: a document with `<!DOCTYPE` is refused, so
 * the only entities are the five predefined ones and character references, and nothing is fetched
 * or expanded. Anything else it does not understand is an error, never a silent guess.
 *
 * `fast-xml-parser`, which reads the suite file, is not used here: it does not normalize
 * whitespace in attribute values (XML 1.0 §3.3.3), so a line break written in a `value` attribute
 * would differ from one written as `&#xA;`, and it leaves undefined entities in the text.
 *
 * @see https://www.w3.org/TR/xml/
 * @see https://www.w3.org/TR/xml-names/
 */

/** The namespace bound to the `xml` prefix without a declaration. */
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';

/** The predefined entities ([XML 1.0 §4.6](https://www.w3.org/TR/xml/#sec-predefined-ent)). */
const PREDEFINED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['lt', '<'],
  ['gt', '>'],
  ['amp', '&'],
  ['apos', "'"],
  ['quot', '"'],
]);

/**
 * A qualified name: an optional prefix and a local name. ASCII only; the FHIR and XHTML
 * vocabularies need no more, and a wider name is refused rather than misread.
 */
const QUALIFIED_NAME = /[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?/y;

/** A reference: `&name;`, `&#123;` or `&#x7B;`. */
const REFERENCE = /&(?:#x([0-9A-Fa-f]+)|#([0-9]+)|([A-Za-z_][\w.-]*));/y;

/** A run of character data up to the next markup or reference. */
const CHARACTER_DATA = /[^<&]+/y;

/** A character that XML 1.0 does not allow anywhere in a document ([§2.2](https://www.w3.org/TR/xml/#charsets)). */
const INVALID_CHARACTER = /[^\t\n\r\x20-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/u;

/** An attribute, except namespace declarations. */
export interface XmlAttribute {
  /** The name as written, with its prefix: `value`, `xsi:schemaLocation`. */
  readonly name: string;
  /** The name without its prefix. */
  readonly localName: string;
  /** The namespace of a prefixed attribute. An unprefixed attribute has none. */
  readonly namespace: string | undefined;
  /**
   * The value, with references decoded. Tabs and line breaks written literally are spaces, as
   * [XML 1.0 §3.3.3](https://www.w3.org/TR/xml/#AVNormalize) requires; written as character
   * references they are kept.
   */
  readonly value: string;
}

/** An element. */
export interface XmlElement {
  readonly kind: 'element';
  /** The name as written, with its prefix. */
  readonly name: string;
  /** The name without its prefix. */
  readonly localName: string;
  /** The namespace the element is in, or undefined for none. */
  readonly namespace: string | undefined;
  /** The namespaces this element declares: prefix → URI, with `''` for the default namespace. */
  readonly declarations: ReadonlyMap<string, string>;
  /** The attributes in document order, without namespace declarations. */
  readonly attributes: readonly XmlAttribute[];
  /** Child elements and text, in document order. Comments and processing instructions are left out. */
  readonly children: readonly XmlNode[];
  /** Offset of the element's `<` in {@link XmlDocument.text}. */
  readonly start: number;
  /** Offset just after the element's last `>` in {@link XmlDocument.text}. */
  readonly end: number;
}

/** Character data: text, with references decoded, or the content of a CDATA section. */
export interface XmlText {
  readonly kind: 'text';
  readonly text: string;
  /** Offset of the text in {@link XmlDocument.text}. */
  readonly start: number;
}

/** A child of an element. */
export type XmlNode = XmlElement | XmlText;

/** A parsed document. */
export interface XmlDocument {
  /**
   * The document text with line ends normalized to `\n`
   * ([XML 1.0 §2.11](https://www.w3.org/TR/xml/#sec-line-ends)) and without a byte order mark.
   * Element offsets point into it.
   */
  readonly text: string;
  /** The document element. */
  readonly root: XmlElement;
}

/** Thrown for a document this reader does not accept. */
export class XmlReadError extends Error {
  override readonly name: string = 'XmlReadError';
  /** A stable code such as `xml/undefined-entity`. */
  readonly code: string;
  /** The 1-based line of the problem. */
  readonly line: number;

  constructor(code: string, message: string, line: number) {
    super(`line ${line}: ${message}`);
    this.code = code;
    this.line = line;
  }
}

/**
 * Parses an XML document.
 *
 * @throws {XmlReadError} when the document is not well-formed, has a DTD, uses an undeclared
 * prefix or an undefined entity, or uses a name outside ASCII.
 */
export function readXml(input: string): XmlDocument {
  const text = (input.startsWith('\u{FEFF}') ? input.slice(1) : input).replace(/\r\n?/g, '\n');
  let pos = 0;

  function fail(code: string, message: string, at: number = pos): never {
    const line = text.slice(0, at).split('\n').length;
    throw new XmlReadError(code, message, line);
  }

  const invalid = INVALID_CHARACTER.exec(text);
  if (invalid !== null) {
    fail('xml/invalid-character', 'the document has a character XML does not allow', invalid.index);
  }

  const skipSpace = (): boolean => {
    const from = pos;
    while (pos < text.length && ' \t\n'.includes(text.charAt(pos))) pos++;
    return pos > from;
  };

  const readName = (): string => {
    QUALIFIED_NAME.lastIndex = pos;
    const match = QUALIFIED_NAME.exec(text);
    // A name must end at a delimiter; anything else is a character this reader does not accept.
    if (match === null || !/^[ \t\n/>=?]?$/.test(text.charAt(QUALIFIED_NAME.lastIndex))) {
      return fail('xml/invalid-name', 'expected a name of ASCII letters, digits, ".", "-" and "_"');
    }
    pos = QUALIFIED_NAME.lastIndex;
    return match[0];
  };

  // https://www.w3.org/TR/xml/#sec-comments: `--` may not occur inside a comment.
  const skipComment = (): void => {
    const end = text.indexOf('-->', pos + 4);
    if (end === -1) fail('xml/unclosed-comment', 'a comment is not closed');
    const body = text.slice(pos + 4, end);
    if (body.includes('--') || body.endsWith('-')) {
      fail('xml/invalid-comment', 'a comment contains "--"');
    }
    pos = end + 3;
  };

  const skipProcessingInstruction = (): void => {
    pos += 2;
    const target = readName();
    if (target.toLowerCase() === 'xml') {
      fail('xml/misplaced-declaration', 'the XML declaration must start the document');
    }
    const end = text.indexOf('?>', pos);
    if (end === -1)
      fail('xml/unclosed-processing-instruction', 'a processing instruction is not closed');
    pos = end + 2;
  };

  // https://www.w3.org/TR/xml/#sec-references
  const readReference = (): string => {
    REFERENCE.lastIndex = pos;
    const match = REFERENCE.exec(text);
    if (match === null)
      return fail('xml/invalid-reference', 'a "&" must start a reference such as "&amp;"');
    const [, hex, decimal, entity] = match;
    let decoded: string | undefined;
    if (entity !== undefined) {
      decoded = PREDEFINED_ENTITIES.get(entity);
      if (decoded === undefined) {
        return fail('xml/undefined-entity', `the entity &${entity}; is not defined`);
      }
    } else {
      const codePoint = hex !== undefined ? Number.parseInt(hex, 16) : Number(decimal);
      const isChar =
        codePoint <= 0x10ffff && !INVALID_CHARACTER.test(String.fromCodePoint(codePoint));
      if (!isChar)
        fail('xml/invalid-character-reference', `${match[0]} is not a character XML allows`);
      decoded = String.fromCodePoint(codePoint);
    }
    pos = REFERENCE.lastIndex;
    return decoded;
  };

  const readAttributeValue = (): string => {
    const quote = text.charAt(pos);
    if (quote !== '"' && quote !== "'")
      return fail('xml/invalid-attribute', 'an attribute value must be quoted');
    pos++;
    let value = '';
    for (;;) {
      if (pos >= text.length)
        return fail('xml/invalid-attribute', 'an attribute value is not closed');
      const char = text.charAt(pos);
      if (char === quote) {
        pos++;
        return value;
      }
      if (char === '<')
        return fail('xml/invalid-attribute', 'an attribute value may not contain "<"');
      if (char === '&') {
        value += readReference();
      } else {
        value += char === '\t' || char === '\n' ? ' ' : char;
        pos++;
      }
    }
  };

  const resolve = (
    name: string,
    scope: ReadonlyMap<string, string>,
    isElement: boolean,
  ): { readonly localName: string; readonly namespace: string | undefined } => {
    const colon = name.indexOf(':');
    if (colon === -1) {
      // https://www.w3.org/TR/xml-names/#defaulting: the default namespace applies to elements only.
      return { localName: name, namespace: isElement ? scope.get('') : undefined };
    }
    const prefix = name.slice(0, colon);
    const namespace = scope.get(prefix);
    if (namespace === undefined)
      fail('xml/undeclared-prefix', `the prefix "${prefix}" is not declared`);
    return { localName: name.slice(colon + 1), namespace };
  };

  const readElement = (parentScope: ReadonlyMap<string, string>): XmlElement => {
    const start = pos;
    pos++;
    const name = readName();
    const written: { readonly name: string; readonly value: string; readonly at: number }[] = [];
    let isEmpty = false;
    for (;;) {
      const hadSpace = skipSpace();
      if (text.startsWith('/>', pos)) {
        pos += 2;
        isEmpty = true;
        break;
      }
      if (text.charAt(pos) === '>') {
        pos++;
        break;
      }
      if (!hadSpace) fail('xml/malformed-tag', `<${name}> is malformed`);
      const at = pos;
      const attributeName = readName();
      skipSpace();
      if (text.charAt(pos) !== '=')
        fail('xml/invalid-attribute', `expected "=" after ${attributeName}`);
      pos++;
      skipSpace();
      const value = readAttributeValue();
      if (written.some((attribute) => attribute.name === attributeName)) {
        fail('xml/duplicate-attribute', `<${name}> has two ${attributeName} attributes`, at);
      }
      written.push({ name: attributeName, value, at });
    }

    // https://www.w3.org/TR/xml-names/#ns-decl
    const declarations = new Map<string, string>();
    for (const attribute of written) {
      if (attribute.name === 'xmlns') {
        declarations.set('', attribute.value);
      } else if (attribute.name.startsWith('xmlns:')) {
        if (attribute.value === '') {
          fail('xml/invalid-namespace', `${attribute.name} is empty`, attribute.at);
        }
        declarations.set(attribute.name.slice('xmlns:'.length), attribute.value);
      }
    }
    let scope = parentScope;
    if (declarations.size > 0) {
      const inner = new Map([...parentScope, ...declarations]);
      // xmlns="" takes the element out of the default namespace.
      if (inner.get('') === '') inner.delete('');
      scope = inner;
    }
    const attributes = written
      .filter((attribute) => attribute.name !== 'xmlns' && !attribute.name.startsWith('xmlns:'))
      .map(
        (attribute): XmlAttribute => ({
          name: attribute.name,
          ...resolve(attribute.name, scope, false),
          value: attribute.value,
        }),
      );
    const children = isEmpty ? [] : readContent(name, scope);
    return {
      kind: 'element',
      name,
      ...resolve(name, scope, true),
      declarations,
      attributes,
      children,
      start,
      end: pos,
    };
  };

  const readContent = (name: string, scope: ReadonlyMap<string, string>): XmlNode[] => {
    const children: XmlNode[] = [];
    let chars = '';
    let charsStart = pos;
    const flush = (): void => {
      if (chars !== '') children.push({ kind: 'text', text: chars, start: charsStart });
      chars = '';
    };
    for (;;) {
      if (pos >= text.length) return fail('xml/unclosed-element', `<${name}> is not closed`);
      if (chars === '') charsStart = pos;
      const char = text.charAt(pos);
      if (char === '&') {
        chars += readReference();
      } else if (char !== '<') {
        CHARACTER_DATA.lastIndex = pos;
        const run = CHARACTER_DATA.exec(text)?.[0] ?? '';
        if (run.includes(']]>')) fail('xml/invalid-text', 'text may not contain "]]>"');
        chars += run;
        pos += run.length;
      } else if (text.startsWith('</', pos)) {
        flush();
        pos += 2;
        const closing = readName();
        if (closing !== name)
          fail('xml/mismatched-tag', `expected </${name}>, found </${closing}>`);
        skipSpace();
        if (text.charAt(pos) !== '>') fail('xml/malformed-tag', `</${name}> is malformed`);
        pos++;
        return children;
      } else if (text.startsWith('<![CDATA[', pos)) {
        const end = text.indexOf(']]>', pos);
        if (end === -1) fail('xml/unclosed-cdata', 'a CDATA section is not closed');
        chars += text.slice(pos + '<![CDATA['.length, end);
        pos = end + 3;
      } else if (text.startsWith('<!--', pos)) {
        flush();
        skipComment();
      } else if (text.startsWith('<?', pos)) {
        flush();
        skipProcessingInstruction();
      } else if (text.startsWith('<!', pos)) {
        fail('xml/unsupported-markup', 'only comments and CDATA sections may start with "<!"');
      } else {
        flush();
        children.push(readElement(scope));
      }
    }
  };

  // Comments, processing instructions and whitespace around the document element.
  const skipMisc = (): void => {
    for (;;) {
      skipSpace();
      if (text.startsWith('<!--', pos)) skipComment();
      else if (text.startsWith('<?', pos)) skipProcessingInstruction();
      else return;
    }
  };

  // https://www.w3.org/TR/xml/#sec-prolog-dtd: the declaration may only come first.
  if (/^<\?xml[ \t\n]/.test(text)) {
    const end = text.indexOf('?>');
    if (end === -1)
      fail('xml/unclosed-processing-instruction', 'the XML declaration is not closed');
    pos = end + 2;
  }
  skipMisc();
  if (text.startsWith('<!DOCTYPE', pos)) {
    fail('xml/doctype', 'DTDs are not supported');
  }
  if (text.charAt(pos) !== '<') fail('xml/no-root', 'expected the document element');
  const root = readElement(new Map([['xml', XML_NAMESPACE]]));
  skipMisc();
  if (pos < text.length)
    fail('xml/trailing-content', 'only comments may follow the document element');
  return { text, root };
}
