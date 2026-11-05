// Adapted from losol/lectio-docs `apps/site-builder` (MIT, Losol AS).
import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import {
  type ContentSource,
  createContentSource,
  type Manifest,
} from '@eventuras/lectio-docs/content';

// The collected content (manifest.json and the markdown), written by
// `scripts/collect.ts` before every build. The build runs in `apps/site`.
const root = resolve('.lectio');

let cached: ContentSource | null = null;

/**
 * The content source of the collected manifest, with bodies loaded from disk.
 *
 * `fs` is the right seam here: prerendering runs the loaders in Node at build
 * time, so the static output needs no server.
 */
export function getContentSource(): ContentSource {
  if (cached) {
    return cached;
  }
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf-8')) as Manifest;
  cached = createContentSource({
    manifest,
    loadBody: (page) => {
      // Stay inside the content directory, whatever `page.file` says.
      const filePath = resolve(root, page.file);
      if (filePath !== root && !filePath.startsWith(root + sep)) {
        throw new Error(`Refusing to read outside the content directory: ${page.file}`);
      }
      return readFileSync(filePath, 'utf-8');
    },
  });
  return cached;
}
