// Индекс остановок карты (design D8, spec route-load-map «Routes through a stop»). Прогноза по остановкам
// нет: панель остановки суммирует прогнозы проходящих через неё маршрутов, и это не посадки на остановке.
import type { ReferenceRoute, RouteId } from '../api/types';
import type { OsmRoute } from '../data/osm-routes';

/** Точки ближе этого расстояния — одна остановка (гаверсинус). */
export const STOP_CLUSTER_RADIUS_M = 60;

const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

export type StopSource = 'reference' | 'osm';

/** Точка остановки одного маршрута из одного источника. */
export interface StopPoint {
  /** `ref/<stop_id>` из справочника или `node/<id>` из OpenStreetMap. */
  id: string;
  source: StopSource;
  route: RouteId;
  name: string;
  lat: number;
  lon: number;
}

/** Остановка на карте: точки обоих источников в пределах 60 м. */
export interface StopCluster {
  /** Наименьший идентификатор точки — устойчив между перезагрузками при тех же данных. */
  id: string;
  /** Имя для показа: из справочника, иначе самое частое из OSM; прямые кавычки заменены ёлочками. */
  name: string;
  lat: number;
  lon: number;
  /** Маршруты, проходящие через остановку, по возрастанию. */
  routes: RouteId[];
  points: StopPoint[];
}

export function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Ключ сравнения названий: в справочнике кавычки прямые, в OSM — ёлочки; «ё» и «е» пишут по-разному.
 * `Метро "Семёновская"` и `Метро «Семеновская»` дают один ключ.
 */
export function normalizeStopName(name: string): string {
  return name
    .normalize('NFC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»„“”‟"]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `Метро "Комсомольская"` → `Метро «Комсомольская»`: единое оформление имён из обоих источников. */
export function displayStopName(name: string): string {
  return name.replace(/"([^"]*)"/g, '«$1»').trim();
}

/**
 * Точки остановок по источникам (spec route-load-map «Route geometry»): маршруты, которые есть в справочнике
 * организаторов (1, 5, 7, 11, 12), берут остановки из него, остальные — из OpenStreetMap. Если справочник
 * недоступен или пуст, остановки всех маршрутов берутся из OpenStreetMap.
 */
export function stopPoints(reference: readonly ReferenceRoute[], osm: readonly OsmRoute[]): StopPoint[] {
  const points: StopPoint[] = [];
  const seen = new Set<string>();
  const add = (point: StopPoint) => {
    const key = `${point.route}:${point.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    points.push(point);
  };
  const fromReference = new Set<RouteId>();
  for (const route of reference) {
    for (const trip of route.trips) {
      for (const stop of trip.stops) {
        fromReference.add(route.route);
        add({ id: `ref/${stop.stop_id}`, source: 'reference', route: route.route, name: stop.name, lat: stop.lat, lon: stop.lon });
      }
    }
  }
  for (const route of osm) {
    if (fromReference.has(route.route)) continue;
    for (const stop of route.stops) add({ id: stop.id, source: 'osm', route: route.route, name: stop.name, lat: stop.lat, lon: stop.lon });
  }
  return points;
}

/** Самое частое значение; при равенстве — первое по алфавиту, чтобы результат не зависел от порядка точек. */
function mostFrequent(values: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))[0]?.[0];
}

/**
 * Кластеризация одиночной связью: точки на расстоянии до `radiusM` попадают в одну остановку, в том числе
 * через цепочку соседей. Остановки трамвая стоят в сотнях метров друг от друга, поэтому цепочки остаются в
 * пределах одного узла: на данных 2026-09-27 самый широкий кластер — 82 м («Площадь Академика Люльки»).
 */
export function clusterStops(points: readonly StopPoint[], radiusM = STOP_CLUSTER_RADIUS_M): StopCluster[] {
  const order = points.map((_, index) => index).sort((a, b) => points[a]!.lat - points[b]!.lat);
  const parent = points.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[index] !== root) {
      const next = parent[index]!;
      parent[index] = root;
      index = next;
    }
    return root;
  };
  // Проход по широте: сравниваются только точки, которые по широте ближе радиуса.
  const latWindow = radiusM / (EARTH_RADIUS_M * RAD);
  for (let i = 0; i < order.length; i++) {
    const a = points[order[i]!]!;
    for (let j = i + 1; j < order.length; j++) {
      const b = points[order[j]!]!;
      if (b.lat - a.lat > latWindow) break;
      if (haversineMeters(a, b) <= radiusM) parent[find(order[i]!)] = find(order[j]!);
    }
  }
  const groups = new Map<number, StopPoint[]>();
  points.forEach((point, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(point);
    groups.set(root, group);
  });
  return [...groups.values()].map((group): StopCluster => {
    const referenceName = mostFrequent(group.filter((point) => point.source === 'reference').map((point) => point.name));
    const name = referenceName ?? mostFrequent(group.map((point) => point.name)) ?? '';
    return {
      id: group.map((point) => point.id).sort()[0]!,
      name: displayStopName(name),
      lat: group.reduce((sum, point) => sum + point.lat, 0) / group.length,
      lon: group.reduce((sum, point) => sum + point.lon, 0) / group.length,
      routes: [...new Set(group.map((point) => point.route))].sort((a, b) => a - b),
      points: group,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

/** Остановки, через которые проходит хотя бы один выбранный маршрут. */
export function stopsForRoutes(stops: readonly StopCluster[], routes: readonly RouteId[]): StopCluster[] {
  return stops.filter((stop) => stop.routes.some((route) => routes.includes(route)));
}
