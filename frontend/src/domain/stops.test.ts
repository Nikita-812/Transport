import { describe, expect, it } from 'vitest';
import { parseReferenceMap } from '../api/types';
import { OSM_ROUTES } from '../data/osm-routes';
import referenceFixture from '../test/fixtures/reference-map.json';
import {
  clusterStops, displayStopName, haversineMeters, normalizeStopName, stopPoints, stopsForRoutes, STOP_CLUSTER_RADIUS_M, type StopPoint,
} from './stops';

const reference = parseReferenceMap(referenceFixture);
const stops = clusterStops(stopPoints(reference.routes, OSM_ROUTES.routes));
const named = (name: string) => stops.filter((stop) => normalizeStopName(stop.name) === normalizeStopName(name));

function point(id: string, route: StopPoint['route'], lat: number, lon: number, source: StopPoint['source'] = 'osm', name = id): StopPoint {
  return { id, source, route, name, lat, lon };
}

describe('названия остановок', () => {
  it('кавычки и «ё» не мешают сравнению', () => {
    expect(normalizeStopName('Метро "Семёновская"')).toBe(normalizeStopName('Метро  «Семеновская»'));
    expect(normalizeStopName('Метро "Комсомольская"')).toBe('метро "комсомольская"');
  });

  it('прямые кавычки справочника показываются ёлочками', () => {
    expect(displayStopName('Метро "Бульвар Рокоссовского"')).toBe('Метро «Бульвар Рокоссовского»');
    expect(displayStopName('Усадьба Останкино')).toBe('Усадьба Останкино');
  });
});

describe('источники точек', () => {
  it('1, 5, 7, 11, 12 — из справочника, 17, 25, 26, 28, 50 — из OpenStreetMap', () => {
    const points = stopPoints(reference.routes, OSM_ROUTES.routes);
    const sources = (route: number) => new Set(points.filter((item) => item.route === route).map((item) => item.source));
    for (const route of [1, 5, 7, 11, 12]) expect(sources(route)).toEqual(new Set(['reference']));
    for (const route of [17, 25, 26, 28, 50]) expect(sources(route)).toEqual(new Set(['osm']));
  });

  it('без справочника остановки всех маршрутов берутся из OpenStreetMap', () => {
    const points = stopPoints([], OSM_ROUTES.routes);
    expect(new Set(points.map((item) => item.source))).toEqual(new Set(['osm']));
    expect(new Set(points.map((item) => item.route)).size).toBe(10);
  });
});

describe('кластеризация до 60 м', () => {
  it('«Метро „Комсомольская“» — маршруты 7 (справочник) и 50 (OpenStreetMap)', () => {
    const komsomolskaya = named('Метро "Комсомольская"');
    expect(komsomolskaya.map((stop) => stop.routes)).toContainEqual([7, 50]);
    const shared = komsomolskaya.find((stop) => stop.routes.length === 2)!;
    expect(new Set(shared.points.map((item) => `${item.route}:${item.source}`))).toEqual(new Set(['7:reference', '50:osm']));
    expect(shared.name).toBe('Метро «Комсомольская»');
  });

  it('«Усадьба Останкино» — маршруты 11, 17 и 25', () => {
    const ostankino = named('Усадьба Останкино');
    expect(ostankino.length).toBeGreaterThan(0);
    for (const stop of ostankino) expect(stop.routes).toEqual([11, 17, 25]);
  });

  it('точки ближе 60 м — одна остановка, дальше — разные', () => {
    const base = point('a', 17, 55.8, 37.6);
    const near = point('b', 50, 55.8 + 50 / 111_195, 37.6);
    const far = point('c', 25, 55.8 + 70 / 111_195, 37.6);
    expect(haversineMeters(base, near)).toBeLessThan(STOP_CLUSTER_RADIUS_M);
    expect(haversineMeters(base, far)).toBeGreaterThan(STOP_CLUSTER_RADIUS_M);
    expect(clusterStops([base, near]).map((stop) => stop.routes)).toEqual([[17, 50]]);
    expect(clusterStops([base, far])).toHaveLength(2);
  });

  it('одиночная связь объединяет цепочку соседей', () => {
    const step = 50 / 111_195;
    const chain = [point('a', 17, 55.8, 37.6), point('b', 25, 55.8 + step, 37.6), point('c', 50, 55.8 + 2 * step, 37.6)];
    expect(clusterStops(chain)).toHaveLength(1);
  });

  it('имя — из справочника, иначе самое частое из OpenStreetMap', () => {
    const mixed = [
      point('node/1', 17, 55.8, 37.6, 'osm', 'ВДНХ (южный вход)'),
      point('ref/2', 11, 55.8, 37.6001, 'reference', 'ВДНХ (южная)'),
    ];
    expect(clusterStops(mixed)[0]!.name).toBe('ВДНХ (южная)');
    const osmOnly = [
      point('node/1', 17, 55.8, 37.6, 'osm', 'Б'),
      point('node/2', 25, 55.8, 37.6001, 'osm', 'А'),
      point('node/3', 50, 55.8, 37.6002, 'osm', 'Б'),
    ];
    expect(clusterStops(osmOnly)[0]!.name).toBe('Б');
  });

  it('на настоящих данных цепочки не склеивают разные узлы', () => {
    const diameters = stops.map((stop) => Math.max(...stop.points.flatMap((a) => stop.points.map((b) => haversineMeters(a, b)))));
    expect(Math.max(...diameters)).toBeLessThan(2 * STOP_CLUSTER_RADIUS_M);
    expect(stops.every((stop) => stop.routes.length > 0 && stop.name.length > 0)).toBe(true);
  });

  it('на карте — остановки хотя бы одного выбранного маршрута', () => {
    const visible = stopsForRoutes(stops, [50]);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((stop) => stop.routes.includes(50))).toBe(true);
    expect(stopsForRoutes(stops, [])).toEqual([]);
  });
});
