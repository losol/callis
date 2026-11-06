/** An XML element with its attributes and child elements. Text content is not kept. */
export interface XmlElement {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: readonly XmlElement[];
}

interface OpenElement {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: XmlElement[];
}

const NAME = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;
const ATTRIBUTE = /\s+([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;
const TAG_END = /\s*(\/?)>/y;
const PREDEFINED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  quot: '"',
});

/**
 * Reads the element tree of a well-formed XML document, as far as the UCUM essence file needs:
 * elements, attributes, comments, processing instructions and CDATA sections. Text is skipped.
 * Document type declarations are rejected, so no external or custom entities are ever expanded.
 *
 * @returns the root element, or `undefined` if the text is not well-formed.
 * @see https://www.w3.org/TR/xml/
 */
export function readXmlElements(text: string): XmlElement | undefined {
  const stack: OpenElement[] = [];
  let root: XmlElement | undefined;
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('<', index);
    if (open === -1) {
      if (!isAllowedText(text.slice(index), stack.length)) return undefined;
      break;
    }
    if (!isAllowedText(text.slice(index, open), stack.length)) return undefined;
    if (text.startsWith('<?', open)) {
      const end = text.indexOf('?>', open + 2);
      if (end === -1) return undefined;
      index = end + 2;
    } else if (text.startsWith('<!--', open)) {
      const end = text.indexOf('-->', open + 4);
      if (end === -1) return undefined;
      index = end + 3;
    } else if (text.startsWith('<![CDATA[', open)) {
      const end = text.indexOf(']]>', open + 9);
      if (end === -1 || stack.length === 0) return undefined;
      index = end + 3;
    } else if (text.startsWith('<!', open)) {
      // DOCTYPE and other declarations could define entities; the essence file has none.
      return undefined;
    } else if (text.startsWith('</', open)) {
      NAME.lastIndex = open + 2;
      const name = NAME.exec(text)?.[0];
      const element = stack.pop();
      if (name === undefined || element === undefined || element.name !== name) return undefined;
      TAG_END.lastIndex = open + 2 + name.length;
      const end = TAG_END.exec(text);
      if (end === null || end[1] === '/') return undefined;
      index = TAG_END.lastIndex;
      const closed: XmlElement = {
        name: element.name,
        attributes: element.attributes,
        children: element.children,
      };
      const parent = stack.at(-1);
      if (parent === undefined) root = closed;
      else parent.children.push(closed);
    } else {
      if (root !== undefined) return undefined;
      NAME.lastIndex = open + 1;
      const name = NAME.exec(text)?.[0];
      if (name === undefined) return undefined;
      index = open + 1 + name.length;
      const attributes = new Map<string, string>();
      for (;;) {
        ATTRIBUTE.lastIndex = index;
        const attribute = ATTRIBUTE.exec(text);
        if (attribute === null) break;
        const [, key = '', double, single] = attribute;
        const value = decodeEntities(double ?? single ?? '');
        if (value === undefined || attributes.has(key)) return undefined;
        attributes.set(key, value);
        index = ATTRIBUTE.lastIndex;
      }
      TAG_END.lastIndex = index;
      const end = TAG_END.exec(text);
      if (end === null) return undefined;
      index = TAG_END.lastIndex;
      if (end[1] === '/') {
        const element: XmlElement = { name, attributes, children: [] };
        const parent = stack.at(-1);
        if (parent === undefined) root = element;
        else parent.children.push(element);
      } else {
        stack.push({ name, attributes, children: [] });
      }
    }
  }
  return stack.length === 0 ? root : undefined;
}

/** Text inside elements is skipped; outside the root element only whitespace may appear. */
function isAllowedText(text: string, depth: number): boolean {
  return depth > 0 || /^[ \t\r\n]*$/.test(text);
}

/** Replaces the predefined entities and character references; undefined for anything else. */
function decodeEntities(value: string): string | undefined {
  let invalid = false;
  const decoded = value.replace(/&([^;]*);?/g, (match, reference: string) => {
    if (!match.endsWith(';')) {
      invalid = true;
      return '';
    }
    if (Object.hasOwn(PREDEFINED_ENTITIES, reference)) return PREDEFINED_ENTITIES[reference] ?? '';
    const code = /^#[0-9]+$/.test(reference)
      ? Number.parseInt(reference.slice(1), 10)
      : /^#x[0-9A-Fa-f]+$/.test(reference)
        ? Number.parseInt(reference.slice(2), 16)
        : Number.NaN;
    if (
      !Number.isInteger(code) ||
      code < 1 ||
      code > 0x10ffff ||
      (code >= 0xd800 && code <= 0xdfff)
    ) {
      invalid = true;
      return '';
    }
    return String.fromCodePoint(code);
  });
  return invalid ? undefined : decoded;
}
