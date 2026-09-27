import mainSource from 'maplibre-gl/dist/maplibre-gl.mjs?raw';
import sharedSource from 'maplibre-gl/dist/maplibre-gl-shared.mjs?raw';
import workerSource from 'maplibre-gl/dist/maplibre-gl-worker.mjs?raw';
import { describe, expect, it } from 'vitest';
import { linkShared } from './maplibre';

/** Статические относительные импорты: из blob-URL они не разрешаются. */
const RELATIVE_IMPORT = /(?:from|import)\s*\(?\s*["'`]\.{1,2}\//g;

describe('MapLibre из blob-модулей', () => {
  it('основной модуль и воркер импортируют только общий модуль, и ссылка заменяется на его blob', () => {
    for (const source of [mainSource, workerSource]) {
      const linked = linkShared(source, 'blob:http://127.0.0.1:8000/shared');
      expect(linked).not.toContain('./maplibre-gl-shared.mjs');
      expect(linked).toContain('"blob:http://127.0.0.1:8000/shared"');
      expect(linked.match(RELATIVE_IMPORT)).toBeNull();
    }
    expect(sharedSource.match(RELATIVE_IMPORT)).toBeNull();
  });

  it('если формат пакета изменился, ошибка понятна', () => {
    expect(() => linkShared('export const version = 7;', 'blob:x')).toThrow('изменился формат пакета');
  });
});
