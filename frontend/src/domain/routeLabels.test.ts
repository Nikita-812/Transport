import { describe, expect, it } from 'vitest';
import type { LngLat, OsmRoute } from '../data/osm-routes';
import { OSM_ROUTES } from '../data/osm-routes';
import { routeLabelAnchors, UNIQUE_M } from './routeLabels';
import { haversineMeters } from './stops';

const at = ([lon, lat]: LngLat) => ({ lat, lon });

/** Расстояние от точки до ломаной, м (достаточно точно для отрезков в пределах города). */
function distanceToLines(point: LngLat, lines: readonly LngLat[][]): number {
  let best = Infinity;
  for (const line of lines) {
    for (let index = 1; index < line.length; index++) {
      const a = line[index - 1]!;
      const b = line[index]!;
      for (let k = 0; k <= 20; k++) {
        const mid: LngLat = [a[0] + ((b[0] - a[0]) * k) / 20, a[1] + ((b[1] - a[1]) * k) / 20];
        best = Math.min(best, haversineMeters(at(point), at(mid)));
      }
    }
  }
  return best;
}

describe('подписи номеров маршрутов', () => {
  const anchors = routeLabelAnchors(OSM_ROUTES.routes);

  it('у каждого из 10 маршрутов есть подпись на его линии', () => {
    expect([...anchors.keys()]).toEqual(OSM_ROUTES.routes.map((route) => route.route));
    for (const route of OSM_ROUTES.routes) expect(distanceToLines(anchors.get(route.route)!, route.lines)).toBeLessThan(10);
  });

  it('подписи 11 и 12 не накладываются, хотя маршруты делят пути', () => {
    const distance = haversineMeters(at(anchors.get(11)!), at(anchors.get(12)!));
    expect(distance).toBeGreaterThan(1000);
    const route12 = OSM_ROUTES.routes.find((route) => route.route === 12)!;
    expect(distanceToLines(anchors.get(11)!, route12.lines)).toBeGreaterThan(UNIQUE_M * 0.9);
  });

  it('подписи разных маршрутов не ближе 1 км друг к другу', () => {
    const points = [...anchors.values()];
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) expect(haversineMeters(at(points[i]!), at(points[j]!))).toBeGreaterThan(1000);
    }
  });

  it('если своего участка нет, подпись ставится там, где другие маршруты дальше всего', () => {
    const shared: LngLat[] = [[37.6, 55.75], [37.61, 55.75]];
    const routes: OsmRoute[] = [
      { route: 1, relations: [], stops: [], lines: [shared] },
      { route: 5, relations: [], stops: [], lines: [[[37.6, 55.75], [37.605, 55.75], [37.605, 55.76]]] },
    ];
    const result = routeLabelAnchors(routes);
    // Маршрут 5 уходит на север: его подпись — на этом отрезке, а подпись 1 — на восточной половине.
    expect(result.get(5)![1]).toBeGreaterThan(55.752);
    expect(result.get(1)![0]).toBeGreaterThan(37.605);
  });
});
