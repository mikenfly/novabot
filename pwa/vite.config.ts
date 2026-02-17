import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    port: 5174,
    host: true,
    https: true,
    proxy: {
      '/api': 'http://localhost:17284',
      '/ws': { target: 'ws://localhost:17284', ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
