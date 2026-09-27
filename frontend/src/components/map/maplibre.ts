// Загрузка MapLibre GL JS для однофайловой страницы (design D2).
//
// MapLibre 6 поставляется тремя ES-модулями: основной, общий (shared) и воркер, который импортирует общий.
// Воркер по умолчанию ищется рядом со страницей (`/maplibre-gl-worker.mjs`), а сервис отдаёт только `/`,
// поэтому в собранной странице он не стартует. Статический импорт плюс самодостаточный воркер дублировали бы
// общий модуль (+0,5 МБ к бюджету 3,5 МБ). Вместо этого все три модуля вшиты строками и поднимаются из
// blob-URL: общий модуль один для страницы и воркера, а `setWorkerUrl` получает blob воркера. Код MapLibre
// разбирается только при первом открытии карты.
import type * as Maplibre from 'maplibre-gl';
import mainSource from 'maplibre-gl/dist/maplibre-gl.mjs?raw';
import sharedSource from 'maplibre-gl/dist/maplibre-gl-shared.mjs?raw';
import workerSource from 'maplibre-gl/dist/maplibre-gl-worker.mjs?raw';
import 'maplibre-gl/dist/maplibre-gl.css';

export type MaplibreModule = typeof Maplibre;

/** Единственный относительный импорт в основном модуле и воркере. */
const SHARED_SPECIFIER = '"./maplibre-gl-shared.mjs"';

function moduleUrl(source: string): string {
  return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
}

/** Подставляет blob общего модуля вместо относительного пути, который из blob-URL не разрешается. */
export function linkShared(source: string, sharedUrl: string): string {
  if (!source.includes(SHARED_SPECIFIER)) throw new Error('MapLibre: не найден импорт общего модуля — изменился формат пакета');
  return source.replaceAll(SHARED_SPECIFIER, JSON.stringify(sharedUrl));
}

let loading: Promise<MaplibreModule> | null = null;

/** Один экземпляр на страницу; после ошибки следующий вызов пробует заново. */
export function loadMaplibre(): Promise<MaplibreModule> {
  loading ??= (async () => {
    const shared = moduleUrl(sharedSource);
    const main = moduleUrl(linkShared(mainSource, shared));
    const worker = moduleUrl(linkShared(workerSource, shared));
    const maplibre = (await import(/* @vite-ignore */ main)) as MaplibreModule;
    maplibre.setWorkerUrl(worker);
    return maplibre;
  })().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}
