// Adapted from losol/lectio-docs `apps/site-builder` (MIT, Losol AS).
import type { ContentSource, Page } from '@eventuras/lectio-docs/content';

/** Where one link in a document points, once resolved against the manifest. */
export interface DocLink {
  /** Destination: a site path for a page we publish, a forge URL otherwise. */
  href: string;
  /** True when the destination leaves this site. */
  external: boolean;
}

/** Resolved links for a page, keyed by the href as the author wrote it. */
export type DocLinks = Record<string, DocLink>;

/**
 * Resolve the relative markdown links in a page's body.
 *
 * Documentation is authored to read on disk and on the forge, so documents
 * link to each other by path — `[config](../reference/config.md)`. Rendered as
 * written that is a 404, since `/reference/config.md` is a file path and not a
 * slug. The content source knows which page each path is, so this maps every
 * link in the body to where it actually goes.
 *
 * Called from the loader, not the component: the manifest is server-only, and
 * a plain record of hrefs survives serialization into the prerendered page.
 */
export function resolveDocLinks(source: ContentSource, page: Page): DocLinks {
  const links: DocLinks = {};

  for (const href of linkDestinations(page.body)) {
    const key = linkKey(href);
    if (key in links) continue;

    const link = source.resolveLink(href, page.source);
    if (link === null) {
      // Not a link to a Markdown file: a source file, a directory, a fixture.
      // The content source leaves those alone, but they exist in the repository,
      // so they go to the forge.
      const forge = repositoryLink(source, href, page.source);
      if (forge !== null) links[key] = { href: forge, external: true };
      continue;
    }

    if (link.page) {
      links[key] = { href: link.page.slug + link.suffix, external: false };
      continue;
    }

    // A file this site doesn't publish — send it to the forge rather than
    // nowhere. A `?query` would collide with whatever the template carries, so
    // only the fragment travels: a heading anchor is the same on GitHub.
    const forge = source.sourceHref(link.path);
    if (forge !== null) {
      links[key] = {
        href: link.suffix.startsWith('#') ? forge + link.suffix : forge,
        external: true,
      };
    }
  }

  return links;
}

/**
 * Resolves a relative link to something that is not a Markdown file (a source
 * file such as `../../scripts/roadmap.ts`, a directory such as
 * `../../tools/conformance/`, an XML fixture) against the document that holds
 * it, and returns where it lives on the forge. Null for hrefs that are not
 * relative paths (off-site, root-relative, anchor-only) and for paths that leave
 * the repository, which are left as the author wrote them. Only the fragment
 * travels, as in {@link resolveDocLinks}.
 */
export function repositoryLink(
  source: ContentSource,
  href: string,
  fromSource: string,
): string | null {
  if (href === '' || href.startsWith('#') || href.startsWith('/') || ABSOLUTE_HREF.test(href)) {
    return null;
  }
  const suffixAt = href.search(/[#?]/);
  const path = suffixAt === -1 ? href : href.slice(0, suffixAt);
  const suffix = suffixAt === -1 ? '' : href.slice(suffixAt);

  const segments = fromSource.split('/').slice(0, -1);
  for (const segment of decodeOrSame(path).split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  if (segments.length === 0) return null;

  const forge = source.sourceHref(segments.join('/'));
  if (forge === null) return null;
  return suffix.startsWith('#') ? forge + suffix : forge;
}

function decodeOrSame(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** `scheme:` or protocol-relative `//host`: anything that leaves this origin. */
const ABSOLUTE_HREF = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * The key a href is stored and looked up under. The renderer percent-encodes
 * the destination it parsed (`ærlig.md` → `%C3%A6rlig.md`), so both sides are
 * compared decoded.
 */
export function linkKey(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

/**
 * Inline `](destination)` and the definitions of reference links, in the order
 * they appear.
 *
 * Deliberately liberal — it also matches inside code fences. That costs an
 * unused entry (the renderer never asks about code) and can't produce a wrong
 * link, since only what resolves against the manifest is kept. Missing a form
 * leaves that link exactly as it renders today.
 */
const DESTINATION =
  /\]\(\s*(?:<([^<>\n]*)>|([^\s)]*))|^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*(?:<([^<>\n]*)>|(\S+))/gm;

function* linkDestinations(body: string): Generator<string> {
  for (const match of body.matchAll(DESTINATION)) {
    const destination = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (destination) yield destination;
  }
}
