import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SPA. Talks to api-backend over HTTP only (spec §0). In dev we proxy /api → dashboard surface
// so there is a single origin and no CORS fuss locally.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Dashboard API (operators + portals) and the auth exchange.
      '/api': { target: 'http://localhost:4001', changeOrigin: true },
      // Platform-admin (Super Admin) surface.
      '/platform': { target: 'http://localhost:4004', changeOrigin: true },
    },
  },
  build: {
    // Per-portal code-splitting comes with the route lazy-loading (spec §3B). Vite handles
    // route-level chunks automatically from React.lazy in the router.
    target: 'es2022',
  },
});
