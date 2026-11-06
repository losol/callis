import { defineConfig } from 'vite';

// Serve the route's own static HTML, matching deployed prerendered assets.
export default defineConfig({
  appType: 'mpa',
  plugins: [
    {
      name: 'playground-directory-redirect',
      configurePreviewServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url === '/playground') {
            response.writeHead(308, { Location: '/playground/' });
            response.end();
            return;
          }
          next();
        });
      },
    },
  ],
});
