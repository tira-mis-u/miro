import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { hocuspocusPlugin } from './server/viteRealtimePlugin';

export default defineConfig({
  plugins: [react(), tailwindcss(), hocuspocusPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: true,
    allowedHosts: ['.e2b.app'],
  },
});
