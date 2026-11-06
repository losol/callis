import { defineConfig } from 'vite';

// Serve the route's own static HTML, matching deployed prerendered assets.
export default defineConfig({ appType: 'mpa' });
