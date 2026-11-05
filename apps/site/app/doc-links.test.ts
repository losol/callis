import { createContentSource, type Page } from '@eventuras/lectio-docs/content';
import { describe, expect, it } from 'vitest';

import { resolveDocLinks } from './doc-links.ts';

const source = createContentSource({
  manifest: {
    version: 1,
    sourceUrl: 'https://github.com/org/repo/blob/main/{path}',
    pages: [
      {
        slug: '/adr/0001-first',
        title: 'ADR-0001',
        source: 'docs/adr/0001-first.md',
        file: 'adr/0001-first.md',
        section: '/',
        frontmatter: {},
      },
    ],
  },
  loadBody: () => '',
});

/** The links resolved for a document at `from` whose body is `body`. */
function resolve(from: string, body: string) {
  return resolveDocLinks(source, { source: from, body } as Page);
}

describe('resolveDocLinks', () => {
  it('sends a link to a published Markdown file to its page', () => {
    expect(resolve('docs/architecture.md', '[a](adr/0001-first.md#why)')).toEqual({
      'adr/0001-first.md#why': { href: '/adr/0001-first#why', external: false },
    });
  });

  it('sends a link to an unpublished Markdown file to GitHub', () => {
    expect(resolve('docs/architecture.md', '[a](../AGENTS.md)')).toEqual({
      '../AGENTS.md': { href: 'https://github.com/org/repo/blob/main/AGENTS.md', external: true },
    });
  });

  it('sends a link to a source file to GitHub, resolved against the document', () => {
    expect(resolve('CONTRIBUTING.md', '[c](apps/site/docs.config.ts)')).toEqual({
      'apps/site/docs.config.ts': {
        href: 'https://github.com/org/repo/blob/main/apps/site/docs.config.ts',
        external: true,
      },
    });
  });

  it('resolves a fixture link from a nested document, and keeps the fragment only', () => {
    const links = resolve(
      'docs/conformance/r4.md',
      '[x](../../tools/conformance/fixtures/r4/tests-fhir-r4.xml#t?q=1)',
    );
    expect(links['../../tools/conformance/fixtures/r4/tests-fhir-r4.xml#t?q=1']).toEqual({
      href: 'https://github.com/org/repo/blob/main/tools/conformance/fixtures/r4/tests-fhir-r4.xml#t?q=1',
      external: true,
    });
  });

  it('sends a link to a directory to GitHub', () => {
    expect(resolve('docs/architecture.md', '[t](../tools/conformance/)')).toEqual({
      '../tools/conformance/': {
        href: 'https://github.com/org/repo/blob/main/tools/conformance',
        external: true,
      },
    });
  });

  it('leaves off-site, root-relative and anchor-only links alone', () => {
    expect(
      resolve('docs/a.md', '[a](https://example.com/x) [b](/progress) [c](#top) [d](mailto:a@b.c)'),
    ).toEqual({});
  });

  it('leaves a path that leaves the repository alone', () => {
    expect(resolve('docs/a.md', '[a](../../../outside.ts)')).toEqual({});
  });
});
