import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig(({ mode }) => {
  // Load env vars from project root (.env), all prefixes
  const env = loadEnv(mode, '..', '');
  const webPort = parseInt(env.WEB_PORT || '17284');
  const vitePort = parseInt(env.VITE_PORT || '5174');

  return {
    plugins: [react(), basicSsl()],
    server: {
      port: vitePort,
      host: true,
      https: true,
      proxy: {
        '/api': `http://localhost:${webPort}`,
        '/ws': { target: `ws://localhost:${webPort}`, ws: true },
      },
    },
    build: { outDir: 'dist', sourcemap: true },
  };
});
