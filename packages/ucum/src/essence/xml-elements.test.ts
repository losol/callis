import { describe, expect, it } from 'vitest';
import { readXmlElements, type XmlElement } from './xml-elements.ts';

function shape(element: XmlElement | undefined): unknown {
  return element === undefined
    ? undefined
    : {
        name: element.name,
        attributes: Object.fromEntries(element.attributes),
        children: element.children.map(shape),
      };
}

// https://www.w3.org/TR/xml/
describe('readXmlElements', () => {
  it('reads elements, attributes and self-closing elements, skipping text', () => {
    const xml = `<?xml version="1.0" encoding="ascii"?>
<root a="1" b='two'>
  <unit Code="[in_i'H2O]">text <sup>2</sup> more</unit>
  <empty/>
</root>
`;
    expect(shape(readXmlElements(xml))).toEqual({
      name: 'root',
      attributes: { a: '1', b: 'two' },
      children: [
        {
          name: 'unit',
          attributes: { Code: "[in_i'H2O]" },
          children: [{ name: 'sup', attributes: {}, children: [] }],
        },
        { name: 'empty', attributes: {}, children: [] },
      ],
    });
  });

  it('decodes the predefined entities and character references in attributes', () => {
    const root = readXmlElements(`<r v="&lt;&gt;&amp;&quot;&apos; &#215;&#xB5;"/>`);
    expect(root?.attributes.get('v')).toBe(`<>&"' ×µ`);
  });

  it('skips comments, processing instructions and CDATA sections', () => {
    const xml = '<!-- c --><?pi x?><r><!-- <x> --><![CDATA[<y>]]><?pi?></r><!-- end -->';
    expect(shape(readXmlElements(xml))).toEqual({ name: 'r', attributes: {}, children: [] });
  });

  it.each([
    ['a document type declaration', '<!DOCTYPE r [<!ENTITY e "x">]><r/>'],
    ['a mismatched end tag', '<r><a></b></r>'],
    ['an unclosed element', '<r><a></r>'],
    ['an end tag without a start tag', '</r>'],
    ['two root elements', '<r/><s/>'],
    ['text outside the root element', 'x<r/>'],
    ['text after the root element', '<r/>x'],
    ['an unknown entity', '<r v="&nbsp;"/>'],
    ['an entity without a semicolon', '<r v="&amp"/>'],
    ['a NUL character reference', '<r v="&#0;"/>'],
    ['a surrogate character reference', '<r v="&#xD800;"/>'],
    ['a duplicate attribute', '<r v="1" v="2"/>'],
    ['a < in an attribute value', '<r v="<"/>'],
    ['an unquoted attribute value', '<r v=1/>'],
    ['an unterminated comment', '<r><!-- </r>'],
    ['an unterminated processing instruction', '<?xml <r/>'],
    ['an unterminated CDATA section', '<r><![CDATA[</r>'],
    ['CDATA outside the root element', '<![CDATA[x]]><r/>'],
    ['a missing element name', '<r>< a/></r>'],
    ['no element at all', '   '],
  ])('rejects %s', (_, xml) => {
    expect(readXmlElements(xml)).toBeUndefined();
  });
});
