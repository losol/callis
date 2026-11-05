// Adapted from losol/lectio-docs `apps/site-builder` (MIT, Losol AS).

// Design tokens and component styles of ratio-ui, which @eventuras/markdown
// renders the documents with.
//
// `?url` and the `links` export, not a side-effect import: React Router renders
// the whole <html> document, so the stylesheet must be a real <link> in the
// prerendered head, not something Vite injects after hydration.
import ratioUiStylesheet from '@eventuras/ratio-ui/ratio-ui.css?url';
import type { ReactNode } from 'react';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';

import { SiteHeader } from './components/site-header';
import siteStylesheet from './site.css?url';
import { THEME_KEY } from './theme';

export function links() {
  return [
    { rel: 'stylesheet', href: ratioUiStylesheet },
    { rel: 'stylesheet', href: siteStylesheet },
  ];
}

// Resolve the theme before first paint, so the stored choice (or the default,
// dark) is there from the first frame and nothing flashes light first.
const themeInit = `document.documentElement.setAttribute('data-theme', (function () { try { var t = localStorage.getItem('${THEME_KEY}'); if (t === 'light' || t === 'dark') return t; } catch (e) {} return 'dark'; })());`;

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script with no user input, run before first paint */}
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <>
      <SiteHeader />
      <Outlet />
    </>
  );
}
