import { index, type RouteConfig, route } from '@react-router/dev/routes';

// Docs occupy the site root: manifest slugs map 1:1 onto URLs, and one module
// (docs.tsx) serves them all, "/" via the index route and the rest via the
// splat. The progress page is a route of its own, listed before the splat.
export default [
  index('routes/docs.tsx', { id: 'docs-index' }),
  route('progress', 'routes/progress.tsx'),
  route('playground', 'routes/playground.tsx'),
  route('*', 'routes/docs.tsx'),
] satisfies RouteConfig;
