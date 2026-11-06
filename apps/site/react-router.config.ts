import { readFileSync } from 'node:fs';

import type { Config } from '@react-router/dev/config';

/**
 * A static site: every collected page and the progress page are prerendered at
 * build time, so the output is plain HTML and a Worker only serves assets.
 *
 * Prerendering runs the loaders in Node, which is why `content.server.ts` and
 * `progress.server.ts` can read the collected files from disk. The path list is
 * the manifest's slugs: `collect` has already decided what exists.
 */
export default {
  ssr: false,
  prerender() {
    const manifest = JSON.parse(readFileSync('.lectio/manifest.json', 'utf-8')) as {
      pages: Array<{ slug: string }>;
    };
    return [...manifest.pages.map((page) => page.slug), '/progress', '/playground'];
  },
} satisfies Config;
