#!/usr/bin/env node
// Копирует однофайловую сборку frontend/dist/index.html в static/index.html, который отдаёт forecast_api.py.
// static/index.html — артефакт сборки: руками не редактируется (design D2).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '..', 'dist', 'index.html');
const targetDir = path.resolve(here, '..', '..', 'static');
const target = path.join(targetDir, 'index.html');

if (!existsSync(source)) {
  console.error(`publish_static: нет ${source}; сначала выполните vite build`);
  process.exit(1);
}
mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
console.log(`publish_static: ${path.relative(process.cwd(), source)} → ${path.relative(process.cwd(), target)}`);
