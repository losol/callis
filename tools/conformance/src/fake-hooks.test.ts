import { describe, expect, it } from 'vitest';
import { r4 } from '../../../packages/fhir-r4/src/index.ts';
import { r5 } from '../../../packages/fhir-r5/src/index.ts';
import { checkHtml, checkProfile, fakeHooks } from './fake-hooks.ts';

// https://hl7.org/fhir/R5/narrative.html#xhtml; the R5 HTMLChecks group.
describe('checkHtml', () => {
  it.each([
    ['<b>This</b> <i>is</i> valid <code>HTML</code>', true],
    ['<b>This</b> <i>is</i> valid <button>HTML</button>', false],
    ['plain text', true],
    ['<p class="x">a<br/>b</p>', true],
    ['<script>alert(1)</script>', false],
    ['<DIV><P>upper case</P></DIV>', true],
  ])('%j as a string is %s', (html, expected) => {
    expect(checkHtml(html, 'string')).toBe(expected);
  });

  it.each([
    ['<div xmlns="http://www.w3.org/1999/xhtml"><p>Peter</p></div>', true],
    ['  <div><table><tr><td>x</td></tr></table></div>', true],
    ['<p>no div root</p>', false],
    ['<div><form>no forms</form></div>', false],
    ['<divider>not a div</divider>', false],
  ])('%j as xhtml is %s', (html, expected) => {
    expect(checkHtml(html, 'xhtml')).toBe(expected);
  });
});

// The testConformsTo group of the R4 and R5 suites.
describe('checkProfile', () => {
  const patient = { resourceType: 'Patient', id: 'p' };
  const base = 'http://hl7.org/fhir/StructureDefinition/';

  it.each([r4, r5])('answers for the base profiles of the resource types (version %s)', (model) => {
    expect(checkProfile(model, patient, `${base}Patient`)).toBe(true);
    expect(checkProfile(model, patient, `${base}Person`)).toBe(false);
    expect(checkProfile(model, patient, `${base}DomainResource`)).toBe(true);
    expect(checkProfile(model, { resourceType: 'Nothing' }, `${base}Patient`)).toBe(false);
    expect(checkProfile(model, 'text', `${base}Patient`)).toBe(false);
  });

  it.each(['http://trash', `${base}HumanName`, `${base}string`, `${base}patient`, ''])(
    'raises eval/invalid-argument for %j, which is not a base profile of a resource type',
    (profile) => {
      expect(() => checkProfile(r5, patient, profile)).toThrow(
        expect.objectContaining({ code: 'eval/invalid-argument' }),
      );
    },
  );
});

describe('fakeHooks', () => {
  it('answers through promises', async () => {
    const hooks = fakeHooks(r4);
    await expect(
      hooks.conformsTo?.(
        { resourceType: 'Patient' },
        'http://hl7.org/fhir/StructureDefinition/Patient',
        {
          signal: undefined,
        },
      ),
    ).resolves.toBe(true);
    await expect(
      hooks.htmlChecks?.('<b>x</b>', { signal: undefined, kind: 'string' }),
    ).resolves.toBe(true);
    expect(hooks.terminology).toBeUndefined();
    expect(hooks.resolve).toBeUndefined();
  });
});
