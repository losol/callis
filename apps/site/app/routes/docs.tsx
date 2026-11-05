// Adapted from losol/lectio-docs `apps/site-builder` (MIT, Losol AS).

import type { TreeNode } from '@eventuras/lectio-docs/content';
import { extractHeadings, type MarkdownComponents, MarkdownContent } from '@eventuras/markdown';
import { Heading } from '@eventuras/ratio-ui/core/Heading';
import { Link as TextLink } from '@eventuras/ratio-ui/core/Link';
import { NavTree } from '@eventuras/ratio-ui/core/NavTree';
import { TableOfContents } from '@eventuras/ratio-ui/core/TableOfContents';
import { getTextContent, slugify } from '@eventuras/ratio-ui/utils';
import { type ReactNode, useMemo } from 'react';
import { Link, useLoaderData } from 'react-router';

import { getContentSource } from '../content.server';
import { type DocLinks, linkKey, resolveDocLinks } from '../doc-links';
import docsStylesheet from './docs.css?url';

export function links() {
  return [{ rel: 'stylesheet', href: docsStylesheet }];
}

export async function loader({ params }: { params: Record<string, string | undefined> }) {
  const source = getContentSource();

  // Docs are served at the site root, so manifest slugs map 1:1 onto URLs.
  const rest = (params['*'] ?? '').replace(/\/$/, '');
  const slug = rest ? `/${rest}` : '/';

  const page = await source.getPage(slug);
  if (!page) {
    throw new Response(`No document for "${slug}"`, { status: 404 });
  }

  // The nav groups are plain data, computed here so the site header can read
  // them back through `useMatches` and render the same tree in its mobile menu.
  // The links are resolved here because only the server holds the manifest.
  return {
    page,
    navGroups: toNavGroups(source.getTree()),
    slug,
    links: resolveDocLinks(source, page),
  };
}

/**
 * Serializable shape of the nav tree: a plain-strings subset of ratio-ui's
 * `NavTreeGroup`, shared with the site header.
 */
export interface DocsNavItem {
  title: string;
  href?: string;
  id?: string;
  children?: DocsNavItem[];
}
export interface DocsNavGroup {
  label?: string;
  items: DocsNavItem[];
}

/**
 * The content tree as NavTree groups: root-level pages form the first
 * (unlabelled) group, and each section becomes a group with its title as the
 * eyebrow. It follows the manifest and is not maintained by hand.
 */
function toNavGroups(tree: TreeNode[]): DocsNavGroup[] {
  const toItem = (node: TreeNode): DocsNavItem => ({
    title: node.title,
    ...(node.slug ? { href: node.slug } : { id: node.title }),
    ...(node.children.length > 0 ? { children: node.children.map(toItem) } : {}),
  });

  const rootPages = tree.filter((node) => node.children.length === 0);
  const sections = tree.filter((node) => node.children.length > 0);

  return [
    { items: rootPages.map(toItem) },
    ...sections.map((section) => ({
      label: section.title,
      items: [
        // A section that is itself a page keeps a link to it at the top.
        ...(section.slug ? [{ title: 'Overview', href: section.slug }] : []),
        ...section.children.map(toItem),
      ],
    })),
  ];
}

/** React Router adapter for NavTree: forwards the active, indent and aria props. */
function NavLink({ href, ...rest }: { href: string; children: ReactNode }) {
  return <Link to={href} {...rest} />;
}

// `scheme:` or protocol-relative `//host`: anything that leaves this origin.
const ABSOLUTE_HREF = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * A link in the body, pointed where the loader resolved it: a page of this
 * site, a file on GitHub, or, for anything left alone (off-site, anchors in the
 * page), exactly what the author wrote. Links to pages of this site navigate
 * client-side; the rest are plain anchors, and off-site ones open in a new tab.
 */
function DocAnchor({
  href = '',
  links: resolvedLinks,
  children,
}: {
  href?: string | undefined;
  links: DocLinks;
  children: ReactNode;
}) {
  const resolved = resolvedLinks[linkKey(href)];
  const to = resolved?.href ?? href;
  const offSite = ABSOLUTE_HREF.test(to);
  const internal = resolved ? !resolved.external : to.startsWith('/') && !offSite;

  if (internal) {
    return (
      <TextLink href={to} component={Link} componentProps={{ to }}>
        {children}
      </TextLink>
    );
  }

  return (
    <TextLink
      href={to}
      {...(offSite ? { componentProps: { rel: 'noopener noreferrer', target: '_blank' } } : {})}
    >
      {children}
    </TextLink>
  );
}

export default function DocsPage() {
  const { page, navGroups, slug, links: resolvedLinks } = useLoaderData<typeof loader>();

  const headings = useMemo(() => extractHeadings(page.body), [page.body]);

  // Anchor ids on h2 and h3, slugged with ratio-ui's own `slugify`, the same
  // function `extractHeadings` uses for the table of contents, so scroll-spy and
  // anchors cannot drift; and anchors that follow the loader's link resolution.
  const markdownComponents: MarkdownComponents = useMemo(
    () => ({
      h2: ({ children }) => (
        <Heading as="h2" id={slugify(getTextContent(children))} style={{ scrollMarginTop: 76 }}>
          {children}
        </Heading>
      ),
      h3: ({ children }) => (
        <Heading as="h3" id={slugify(getTextContent(children))} style={{ scrollMarginTop: 76 }}>
          {children}
        </Heading>
      ),
      a: ({ href, children }) => (
        <DocAnchor href={href} links={resolvedLinks}>
          {children}
        </DocAnchor>
      ),
    }),
    [resolvedLinks],
  );

  return (
    <div className="docs-shell">
      <aside className="docs-sidebar">
        <NavTree
          groups={navGroups}
          currentPath={slug}
          LinkComponent={NavLink}
          aria-label="Documentation"
        />
      </aside>

      <div className="docs-content-wrap">
        <main className="docs-main">
          <MarkdownContent
            markdown={page.body}
            allowExternalLinks
            customComponents={markdownComponents}
          />

          <footer className="docs-footer">
            <span>
              from <code>{page.source}</code>
            </span>
            {page.editUrl && (
              <a href={page.editUrl} className="docs-edit-link">
                Edit this page
              </a>
            )}
          </footer>
        </main>

        {headings.length > 0 && (
          <aside className="docs-toc">
            <TableOfContents headings={headings} />
          </aside>
        )}
      </div>
    </div>
  );
}
