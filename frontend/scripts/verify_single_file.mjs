#!/usr/bin/env node
// Проверка однофайловой сборки (design D2). Падает, если страница:
//   - ссылается на локальные файлы (src/href/srcset/poster/url() на относительные пути), которых сервис не раздаёт;
//   - подключает внешние скрипты, стили или картинки (внешняя сеть допустима только для тайлов карты во время работы);
//   - больше 3,5 МБ;
//   - содержит маркер mock-режима;
//   - потеряла lang="ru", заголовок или meta viewport.
// Абсолютные ссылки http(s) в <a href> допустимы: это переходы пользователя, а не загрузка ресурсов.
//
//   node scripts/verify_single_file.mjs [путь]   (по умолчанию ../static/index.html)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MAX_BYTES = 3.5 * 1024 * 1024;
export const MOCK_MARKER = '__TRAM_API_MOCK__';
export const EXPECTED_TITLE = 'Прогноз пассажиропотока трамваев';

const URL_ATTRIBUTES = ['src', 'href', 'srcset', 'poster', 'data', 'action', 'formaction', 'xlink:href'];

/**
 * Значение атрибута допустимо без загрузки чего-либо с сервера.
 * @param {string} value
 */
function isInlineValue(value) {
  const trimmed = value.trim().toLowerCase();
  return trimmed === '' || trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('#');
}

/** @param {string} value */
function isAbsoluteHttp(value) {
  return /^https?:\/\//i.test(value.trim());
}

/**
 * @param {string} text
 * @param {number} index
 */
function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/**
 * Текст разметки без содержимого <script> и <style>: атрибуты ищутся только в настоящих тегах.
 * @param {string} html
 */
function markupOnly(html) {
  return html
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi, '$1$2')
    .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style\s*>)/gi, '$1$2');
}

/**
 * Проверяет HTML собранной страницы.
 * @param {string} html
 * @param {number} [sizeBytes]
 * @returns {string[]} список проблем; пустой — страница годна к поставке
 */
export function verifyHtml(html, sizeBytes = Buffer.byteLength(html, 'utf8')) {
  const problems = [];

  if (sizeBytes > MAX_BYTES) {
    problems.push(`размер ${(sizeBytes / 1024 / 1024).toFixed(2)} МБ больше бюджета ${(MAX_BYTES / 1024 / 1024).toFixed(1)} МБ`);
  }

  const markerAt = html.indexOf(MOCK_MARKER);
  if (markerAt !== -1) problems.push(`в сборку попал mock-адаптер API (маркер ${MOCK_MARKER}, строка ${lineOf(html, markerAt)})`);

  if (!/<html\b[^>]*\blang=["']ru["']/i.test(html)) problems.push('нет <html lang="ru">');
  if (!html.includes(`<title>${EXPECTED_TITLE}</title>`)) problems.push(`нет <title>${EXPECTED_TITLE}</title>`);
  if (!/<meta\b[^>]*name=["']viewport["']/i.test(html)) problems.push('нет <meta name="viewport">');

  const markup = markupOnly(html);
  const tagPattern = /<([a-zA-Z][\w:-]*)\b([^>]*)>/g;
  for (const tag of markup.matchAll(tagPattern)) {
    const name = (tag[1] ?? '').toLowerCase();
    const attributes = tag[2] ?? '';
    for (const attribute of URL_ATTRIBUTES) {
      const pattern = new RegExp(`(?:^|\\s)${attribute.replace(':', '\\:')}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'gi');
      for (const match of attributes.matchAll(pattern)) {
        const value = match[1] ?? match[2] ?? match[3] ?? '';
        const values = attribute === 'srcset' ? value.split(',').map((/** @type {string} */ part) => part.trim().split(/\s+/)[0] ?? '') : [value];
        for (const item of values) {
          if (isInlineValue(item)) continue;
          if (name === 'a' && attribute === 'href' && (isAbsoluteHttp(item) || /^mailto:/i.test(item.trim()))) continue;
          const kind = isAbsoluteHttp(item) ? 'внешний ресурс' : 'ссылка на локальный файл';
          problems.push(`${kind} <${name} ${attribute}="${item}">`);
        }
      }
    }
  }

  // url(...) во встроенных стилях и style-атрибутах: разрешены только data: и blob:.
  for (const match of html.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
    const value = match[2] ?? '';
    if (isInlineValue(value) || value.startsWith('%23')) continue;
    // Строки JS вида url(${...}) или url(" + x + ") — не ссылки на файлы.
    if (/[${}+]/.test(value)) continue;
    problems.push(`CSS url(${value}) не встроен (строка ${lineOf(html, match.index ?? 0)})`);
  }

  // Невстроенные чанки Vite: import("./assets/…") или "/assets/…-hash.js|css".
  for (const match of html.matchAll(/["'`](?:\.{0,2}\/)?assets\/[\w.-]+\.(?:js|mjs|css|wasm|png|svg|woff2?)["'`]/g)) {
    problems.push(`ссылка на файл сборки ${match[0]} (строка ${lineOf(html, match.index ?? 0)})`);
  }

  return [...new Set(problems)];
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const target = path.resolve(process.cwd(), process.argv[2] ?? path.join(here, '..', '..', 'static', 'index.html'));
  let buffer;
  try {
    buffer = readFileSync(target);
  } catch (error) {
    console.error(`verify_single_file: не удалось прочитать ${target}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  const problems = verifyHtml(buffer.toString('utf8'), buffer.byteLength);
  const relative = path.relative(process.cwd(), target) || target;
  if (problems.length > 0) {
    console.error(`verify_single_file: ${relative} не годится для поставки:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  const sha = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
  console.log(`verify_single_file: ${relative} OK — ${(buffer.byteLength / 1024).toFixed(1)} КБ, sha256 ${sha}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
