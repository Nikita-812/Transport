/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// До загрузки тестов и создания worker-процессов: ловим зависимость от локального пояса.
process.env.TZ = 'Asia/Novosibirsk';

// Бекенд разработки (design D3). Переопределяется переменной окружения API_TARGET.
const apiTarget = process.env.API_TARGET ?? 'http://127.0.0.1:8000';

// Все эндпоинты сервиса: /health, /forecasts, /forecasts/export.csv, /forecasts.csv, /reference-map.
const proxiedPaths = ['/health', '/forecasts', '/reference-map'];

export default defineConfig({
  plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
  server: {
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(proxiedPaths.map((path) => [path, { target: apiTarget, changeOrigin: false }])),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Встроенный JS, стили и шрифты отдаются одним файлом; карта исходников в него не попадает.
    sourcemap: false,
    reportCompressedSize: false,
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,mjs}'],
    css: false,
    restoreMocks: true,
  },
});
