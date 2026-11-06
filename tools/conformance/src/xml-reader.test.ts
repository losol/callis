import { describe, expect, it } from 'vitest';
import { readXml, type XmlElement, type XmlNode, XmlReadError } from './xml-reader.ts';

function elements(nodes: readonly XmlNode[]): XmlElement[] {
  return nodes.filter((node): node is XmlElement => node.kind === 'element');
}

function attribute(element: XmlElement | undefined, name: string): string | undefined {
  return element?.attributes.find((item) => item.name === name)?.value;
}

function text(element: XmlElement | undefined): string {
  return (element?.children ?? []).map((node) => (node.kind === 'text' ? node.text : '')).join('');
}

function errorCode(xml: string): string | undefined {
  try {
    readXml(xml);
  } catch (error) {
    if (error instanceof XmlReadError) return error.code;
    throw error;
  }
  return undefined;
}

describe('readXml', () => {
  it('reads elements, attributes and text in document order', () => {
    const { root } = readXml('<a x="1" y=\'2\'><b/>t<c>u</c></a>');
    expect(root.name).toBe('a');
    expect(root.attributes.map((item) => [item.name, item.value])).toEqual([
      ['x', '1'],
      ['y', '2'],
    ]);
    expect(root.children.map((node) => (node.kind === 'text' ? node.text : node.name))).toEqual([
      'b',
      't',
      'c',
    ]);
    expect(text(elements(root.children)[1])).toBe('u');
  });

  // https://www.w3.org/TR/xml/#sec-predefined-ent, https://www.w3.org/TR/xml/#sec-references
  it('decodes the predefined entities and character references in attributes and text', () => {
    const xml =
      '<a v="&lt;&gt;&amp;&apos;&quot; du March&#xE9; &#233; &#x1F600;">&lt;b&gt; &amp;amp; &#39;</a>';
    const { root } = readXml(xml);
    expect(attribute(root, 'v')).toBe(`<>&'" du March\u{E9} \u{E9} \u{1F600}`);
    expect(text(root)).toBe("<b> &amp; '");
  });

  // https://www.w3.org/TR/xml/#AVNormalize
  it('turns literal tabs and line breaks in attribute values into spaces, but keeps references', () => {
    const { root } = readXml('<a v="one\n   two\tthree" w="x&#xA;y&#9;z"/>');
    expect(attribute(root, 'v')).toBe('one    two three');
    expect(attribute(root, 'w')).toBe('x\ny\tz');
  });

  // https://www.w3.org/TR/xml/#sec-line-ends
  it('normalizes CRLF and CR line ends, also in the text that offsets point into', () => {
    const document = readXml('<a>\r\n<b>x\ry</b>\r\n</a>');
    expect(document.text).toBe('<a>\n<b>x\ny</b>\n</a>');
    expect(text(elements(document.root.children)[0])).toBe('x\ny');
  });

  it('reads CDATA sections as text, without decoding references', () => {
    const { root } = readXml('<a>x<![CDATA[a &amp; <b>]]>y</a>');
    expect(text(root)).toBe('xa &amp; <b>y');
  });

  it('skips the XML declaration, a byte order mark, comments and processing instructions', () => {
    const xml =
      '\u{FEFF}<?xml version="1.0" encoding="UTF-8"?>\n<!-- c --><?pi x?><a><!-- d -->x<?pi y?>y</a><!-- e -->\n';
    const { root } = readXml(xml);
    expect(root.name).toBe('a');
    expect(root.children).toEqual([
      { kind: 'text', text: 'x', start: expect.any(Number) },
      { kind: 'text', text: 'y', start: expect.any(Number) },
    ]);
  });

  it('records where each element is in the normalized text', () => {
    const document = readXml('<a>\r\n  <div class="x">a<br/>b</div>\r\n</a>');
    const [div] = elements(document.root.children);
    expect(div === undefined ? undefined : document.text.slice(div.start, div.end)).toBe(
      '<div class="x">a<br/>b</div>',
    );
  });

  // https://www.w3.org/TR/xml-names/
  it('resolves default and prefixed namespaces, with the default for elements only', () => {
    const xml =
      '<f:a xmlns:f="urn:f" xmlns="urn:d" xmlns:x="urn:x" x:y="1" z="2"><b/><c xmlns=""><d/></c></f:a>';
    const { root } = readXml(xml);
    expect([root.localName, root.namespace]).toEqual(['a', 'urn:f']);
    expect(root.declarations).toEqual(
      new Map([
        ['f', 'urn:f'],
        ['', 'urn:d'],
        ['x', 'urn:x'],
      ]),
    );
    expect(root.attributes).toEqual([
      { name: 'x:y', localName: 'y', namespace: 'urn:x', value: '1' },
      { name: 'z', localName: 'z', namespace: undefined, value: '2' },
    ]);
    const [b, c] = elements(root.children);
    expect(b?.namespace).toBe('urn:d');
    expect(c?.namespace).toBeUndefined();
    expect(elements(c?.children ?? [])[0]?.namespace).toBeUndefined();
  });

  it('accepts attributes with one local name in different namespaces', () => {
    const { root } = readXml('<a xmlns:p="urn:p" xmlns:q="urn:q" v="0" p:v="1" q:v="2"/>');
    expect(root.attributes.map((item) => [item.namespace, item.localName])).toEqual([
      [undefined, 'v'],
      ['urn:p', 'v'],
      ['urn:q', 'v'],
    ]);
  });

  it('binds the xml prefix without a declaration, and allows declaring it to its own namespace', () => {
    const { root } = readXml('<a xml:lang="en"/>');
    expect(root.attributes[0]?.namespace).toBe('http://www.w3.org/XML/1998/namespace');
    const declared = readXml('<a xmlns:xml="http://www.w3.org/XML/1998/namespace" xml:lang="en"/>');
    expect(declared.root.attributes[0]?.namespace).toBe('http://www.w3.org/XML/1998/namespace');
  });

  it.each([
    ['a DTD', '<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>', 'xml/doctype'],
    ['an entity that is not predefined', '<a v="&nbsp;"/>', 'xml/undefined-entity'],
    ['an entity in text', '<a>&copy;</a>', 'xml/undefined-entity'],
    [
      'a reference to a character XML does not allow',
      '<a>&#0;</a>',
      'xml/invalid-character-reference',
    ],
    ['a reference beyond Unicode', '<a>&#x110000;</a>', 'xml/invalid-character-reference'],
    ['a reference to a surrogate', '<a>&#xD800;</a>', 'xml/invalid-character-reference'],
    ['a bare ampersand', '<a>fish & chips</a>', 'xml/invalid-reference'],
    ['a control character', '<a>\u{1}</a>', 'xml/invalid-character'],
    ['a mismatched end tag', '<a><b></a></b>', 'xml/mismatched-tag'],
    ['an element that is not closed', '<a><b/>', 'xml/unclosed-element'],
    ['two attributes with one name', '<a x="1" x="2"/>', 'xml/duplicate-attribute'],
    // https://www.w3.org/TR/xml-names/#uniqAttrs
    [
      'two attributes with one expanded name',
      '<a xmlns:p="urn:x" xmlns:q="urn:x" p:v="one" q:v="two"/>',
      'xml/duplicate-attribute',
    ],
    ['attributes without space between them', '<a x="1"y="2"/>', 'xml/malformed-tag'],
    ['an unquoted attribute value', '<a x=1/>', 'xml/invalid-attribute'],
    ['"<" in an attribute value', '<a x="<"/>', 'xml/invalid-attribute'],
    ['an undeclared prefix', '<p:a/>', 'xml/undeclared-prefix'],
    ['an empty prefix declaration', '<a xmlns:p=""/>', 'xml/invalid-namespace'],
    // https://www.w3.org/TR/xml-names/#xmlReserved
    [
      'the xml prefix bound to another namespace',
      '<xml:a xmlns:xml="http://hl7.org/fhir"/>',
      'xml/reserved-namespace',
    ],
    [
      'another prefix bound to the xml namespace',
      '<a xmlns:p="http://www.w3.org/XML/1998/namespace"/>',
      'xml/reserved-namespace',
    ],
    [
      'the xml namespace as the default',
      '<a xmlns="http://www.w3.org/XML/1998/namespace"/>',
      'xml/reserved-namespace',
    ],
    [
      'a declaration of the xmlns prefix',
      '<a xmlns:xmlns="http://www.w3.org/2000/xmlns/"/>',
      'xml/reserved-namespace',
    ],
    [
      'a prefix bound to the xmlns namespace',
      '<a xmlns:p="http://www.w3.org/2000/xmlns/"/>',
      'xml/reserved-namespace',
    ],
    [
      'the xmlns namespace as the default',
      '<a xmlns="http://www.w3.org/2000/xmlns/"/>',
      'xml/reserved-namespace',
    ],
    ['"--" in a comment', '<a><!-- a -- b --></a>', 'xml/invalid-comment'],
    ['a comment that is not closed', '<a><!-- x </a>', 'xml/unclosed-comment'],
    ['an unclosed CDATA section', '<a><![CDATA[x</a>', 'xml/unclosed-cdata'],
    ['"]]>" in text', '<a>x]]>y</a>', 'xml/invalid-text'],
    ['other markup declarations', '<a><!ENTITY e "x"></a>', 'xml/unsupported-markup'],
    [
      'an XML declaration after the start',
      '<a><?xml version="1.0"?></a>',
      'xml/misplaced-declaration',
    ],
    ['a name outside ASCII', '<caf\u{E9}/>', 'xml/invalid-name'],
    ['a second document element', '<a/><b/>', 'xml/trailing-content'],
    ['no document element', '<!-- only a comment -->', 'xml/no-root'],
  ])('refuses %s', (_, xml, code) => {
    expect(errorCode(xml)).toBe(code);
  });

  it('reports the line of a problem', () => {
    expect(() => readXml('<a>\n\n<b>&nbsp;</b></a>')).toThrow(
      expect.objectContaining({ code: 'xml/undefined-entity', line: 3 }),
    );
  });
});
