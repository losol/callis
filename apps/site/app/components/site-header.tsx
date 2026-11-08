// Adapted from losol/lectio-docs `apps/site-builder` (MIT, Losol AS).

import { OramaProvider } from '@eventuras/lectio-docs/search';
import { Search } from '@eventuras/lectio-docs-react';
import { Navbar } from '@eventuras/ratio-ui/core/Navbar';
import { NavTree } from '@eventuras/ratio-ui/core/NavTree';
import { ThemeToggle } from '@eventuras/ratio-ui/core/ThemeToggle';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useMatches, useNavigate } from 'react-router';

import type { DocsNavGroup } from '../routes/docs';
import { site } from '../site.config';
import { THEME_KEY } from '../theme';

type Theme = 'light' | 'dark';

/** React Router adapter for the ratio-ui link components. */
function RouterLink({ href, ...rest }: { href: string; children: ReactNode; className?: string }) {
  return <Link to={href} {...rest} />;
}

/**
 * The site header on ratio-ui's Navbar, with the search palette (it brings its
 * own trigger and the global ⌘K shortcut), the two sections of the site, the
 * theme toggle, and, on narrow screens, the documentation tree folded into the
 * navbar's own menu. The tree comes from the docs route's loader through
 * `useMatches`, so the header does not know about routes.
 *
 * The Navbar is keyed on the pathname because the open state is internal;
 * remounting on navigation closes the menu after a link is followed.
 */
export function SiteHeader() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Static hosts also serve directory URLs such as `/playground/`.
  const currentPath = pathname.replace(/\/+$/, '') || '/';
  const [theme, setTheme] = useState<Theme | null>(null);

  // The search index is built from the collected manifest at build time and
  // shipped as a static asset; Orama restores it in the browser on the first query.
  const provider = useMemo(() => new OramaProvider('/search-index.json'), []);

  const matches = useMatches();
  const docsData = matches.find(
    (match) =>
      match.loaderData && typeof match.loaderData === 'object' && 'navGroups' in match.loaderData,
  )?.loaderData as { navGroups: DocsNavGroup[]; slug: string } | undefined;

  // The theme lives on <html data-theme>, set before first paint by the script
  // in root.tsx. It is read after mount, so server and client render the same.
  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  }, []);

  // Publish the header's height as `--site-header-height` on <html>, for panels
  // that open below the sticky header, such as the task drawer on the progress
  // page. The header wraps on narrow screens, so the height is watched.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the Navbar remounts on navigation (its key is the pathname), and the new element must be observed
  useEffect(() => {
    const header = document.querySelector<HTMLElement>('.site-header');
    if (header === null) {
      return;
    }
    const root = document.documentElement;
    const publish = () => {
      root.style.setProperty('--site-header-height', `${header.getBoundingClientRect().height}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => observer.disconnect();
  }, [pathname]);

  const onThemeChange = (next: Theme) => {
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage is disabled (private mode): the choice holds for this visit only.
    }
    setTheme(next);
  };

  return (
    <Navbar key={pathname} className="site-header" sticky elevated fluid>
      <Navbar.Brand>
        <Link to="/" className="site-brand">
          <span className="site-brand-mark" aria-hidden="true">
            C
          </span>
          <span className="site-brand-name">{site.title}</span>
        </Link>
      </Navbar.Brand>

      <Navbar.Search>
        <Search
          provider={provider}
          placeholder="Search the docs…"
          onNavigate={(url) => navigate(url)}
        />
      </Navbar.Search>

      <Navbar.Links>
        <Navbar.Link
          href="/"
          LinkComponent={RouterLink}
          isCurrent={!['/progress', '/playground'].includes(currentPath)}
        >
          Docs
        </Navbar.Link>
        <Navbar.Link
          href="/playground"
          LinkComponent={RouterLink}
          isCurrent={currentPath === '/playground'}
        >
          Playground
        </Navbar.Link>
        <Navbar.Link
          href="/progress"
          LinkComponent={RouterLink}
          isCurrent={pathname.startsWith('/progress')}
        >
          Progress
        </Navbar.Link>
      </Navbar.Links>

      <Navbar.Spacer />

      <Navbar.Actions>
        <ThemeToggle theme={theme} onThemeChange={onThemeChange} aria-label="Switch theme" />
        <a href={site.githubUrl} className="site-github-link">
          GitHub
        </a>
        {docsData && (
          <span className="site-nav-toggle">
            <Navbar.Toggle controls="docs-nav" aria-label="Documentation menu" />
          </span>
        )}
      </Navbar.Actions>

      {docsData && (
        <div className="site-nav-collapse">
          <Navbar.Collapse id="docs-nav">
            <NavTree
              groups={docsData.navGroups}
              currentPath={docsData.slug}
              LinkComponent={RouterLink}
              aria-label="Documentation"
            />
          </Navbar.Collapse>
        </div>
      )}
    </Navbar>
  );
}
