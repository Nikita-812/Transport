import { describe, expect, it } from 'vitest';
import { MAX_BYTES, MOCK_MARKER, verifyHtml } from './verify_single_file.mjs';

const page = (body: string, head = '') =>
  `<!doctype html><html lang="ru"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width" />` +
  `<title>Прогноз пассажиропотока трамваев</title>${head}</head><body>${body}</body></html>`;

describe('verifyHtml', () => {
  it('однофайловая страница проходит', () => {
    const html = page(
      '<div id="root"></div><a href="https://www.openstreetmap.org/copyright">OSM</a><a href="#top">вверх</a><img src="data:image/png;base64,AA" />',
      '<style>.a{background:url(data:image/svg+xml;base64,AA)}</style><script type="module">const s = "<link href=\\"x.css\\">"; fetch("/health")</script>',
    );
    expect(verifyHtml(html)).toEqual([]);
  });

  it('относительные src и href на файлы', () => {
    const problems = verifyHtml(page('<script src="./assets/index.js"></script>', '<link rel="stylesheet" href="/assets/style.css">'));
    expect(problems.some((problem) => problem.includes('<script src="./assets/index.js">'))).toBe(true);
    expect(problems.some((problem) => problem.includes('<link href="/assets/style.css">'))).toBe(true);
  });

  it('относительная ссылка <a> тоже запрещена', () => {
    expect(verifyHtml(page('<a href="favicon.ico">x</a>'))).toHaveLength(1);
  });

  it('внешние скрипты и стили запрещены', () => {
    expect(verifyHtml(page('<script src="https://cdn.example.com/x.js"></script>'))[0]).toContain('внешний ресурс');
  });

  it('CSS url() на файл', () => {
    expect(verifyHtml(page('', '<style>.a{background:url("./tile.png")}</style>'))[0]).toContain('CSS url(./tile.png)');
  });

  it('вызовы вида getDataURL(e) и revokeObjectURL(n) в JS не считаются ссылками', () => {
    const script = '<script type="module">const u=URL.createObjectURL(b);URL.revokeObjectURL(u);return this.getDataURL(e)</script>';
    expect(verifyHtml(page('', script))).toEqual([]);
  });

  it('невстроенный чанк в JS', () => {
    expect(verifyHtml(page('', '<script type="module">import("./assets/chunk-abc.js")</script>'))[0]).toContain('файл сборки');
  });

  it('маркер mock-режима', () => {
    expect(verifyHtml(page('', `<script>console.info("[${MOCK_MARKER}]")</script>`))[0]).toContain('mock-адаптер');
  });

  it('размер больше бюджета', () => {
    expect(verifyHtml(page(''), MAX_BYTES + 1)[0]).toContain('больше бюджета');
  });

  it('язык, заголовок и viewport обязательны', () => {
    expect(verifyHtml('<html><head></head><body></body></html>')).toHaveLength(3);
  });
});
