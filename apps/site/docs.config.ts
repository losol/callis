import type { DocsConfig } from '@eventuras/lectio-docs';

const repository = 'https://github.com/losol/callis';

/**
 * What the site publishes. The repository is public, so everything under
 * `docs/**` is published. To leave a document out, add its path to `ignore`:
 * links to it then go to GitHub.
 *
 * Paths are relative to the repository root. The order of the sources is the
 * order of the sidebar.
 */
const docsConfig: DocsConfig = {
  output: '.lectio',
  sources: [
    { glob: 'README.md', target: '/' },
    { glob: 'CONTRIBUTING.md', target: '/' },
    {
      glob: 'docs/**/*.md',
      target: '/',
      ignore: [],
      order: ['architecture', 'adr', 'roadmap', 'tasks', 'guides', 'spec-notes', 'conformance'],
    },
    {
      glob: 'packages/*/README.md',
      target: '/packages',
      titleFromPackageJson: true,
      descriptionFromPackageJson: true,
      sectionTitle: 'Packages',
    },
    {
      glob: 'tools/*/README.md',
      target: '/tools',
      titleFromPackageJson: true,
      sectionTitle: 'Tools',
    },
  ],
  editUrl: `${repository}/edit/main/{path}`,
  // Where a link to a document the site does not publish goes.
  sourceUrl: `${repository}/blob/main/{path}`,
};

export default docsConfig;
