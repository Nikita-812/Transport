// Геометрия путей и остановки маршрутов из OpenStreetMap (design D9). Файл osm-routes.json создаёт
// scripts/fetch_osm_routes.mjs; он закоммичен и вшит в сборку, в работе Overpass не нужен.
import type { RouteId } from '../api/types';
import raw from './osm-routes.json';

/** Долгота и широта, как в GeoJSON. */
export type LngLat = [number, number];

export interface OsmStop {
  /** `node/<id>` в OpenStreetMap. */
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface OsmRelation {
  id: number;
  name: string;
  from: string;
  to: string;
}

export interface OsmRoute {
  route: RouteId;
  /** Relation PTv2, по одному на направление. */
  relations: OsmRelation[];
  /** Отрезки путей (MultiLineString): склеенные пути обоих направлений. */
  lines: LngLat[][];
  /** Остановки обоих направлений без повторов узлов. */
  stops: OsmStop[];
}

export interface OsmRoutesData {
  source: string;
  license: string;
  attribution: string;
  fetched_at: string;
  /** Состояние базы OSM на зеркале Overpass. */
  osm_base: string | null;
  endpoint: string;
  simplified: null | { tolerance_m: number };
  routes: OsmRoute[];
}

/** Форму файла проверяет `osm-routes.test.ts`, поэтому здесь достаточно приведения типа. */
export const OSM_ROUTES = raw as unknown as OsmRoutesData;
