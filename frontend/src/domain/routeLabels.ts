// Где поставить подпись номера маршрута на карте. Маршруты делят пути (11 и 12 — 27 общих остановок),
// поэтому подпись ставится на участок, где рядом нет других маршрутов, и подальше от уже поставленных
// подписей; из подходящих мест выбирается ближайшее к середине линии.
import type { RouteId } from '../api/types';
import type { LngLat, OsmRoute } from '../data/osm-routes';

/** Метры на градус в окрестности Москвы: для сравнения расстояний в пределах города достаточно. */
const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON = 111_320 * Math.cos((55.75 * Math.PI) / 180);

/** Шаг выборки линий других маршрутов. */
const SAMPLE_M = 50;
/** Шаг кандидатов на подпись. */
const CANDIDATE_M = 200;
/** Участок «свой», если другие маршруты дальше этого расстояния. */
export const UNIQUE_M = 300;
/** Желаемое расстояние между подписями разных маршрутов. */
export const APART_M = 1500;

interface Sample { x: number; y: number; t: number }

function project([lon, lat]: LngLat): [number, number] {
  return [lon * M_PER_DEG_LON, lat * M_PER_DEG_LAT];
}

function unproject(x: number, y: number): LngLat {
  return [Math.round((x / M_PER_DEG_LON) * 1e5) / 1e5, Math.round((y / M_PER_DEG_LAT) * 1e5) / 1e5];
}

/** Точки вдоль линии с шагом `step` м и относительным положением `t` (0 — начало, 1 — конец). */
function along(line: readonly LngLat[], step: number): Sample[] {
  const points = line.map(project);
  const lengths = points.slice(1).map((point, index) => Math.hypot(point[0] - points[index]![0], point[1] - points[index]![1]));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (points.length < 2 || total === 0) return points.slice(0, 1).map(([x, y]) => ({ x, y, t: 0 }));
  const samples: Sample[] = [];
  let passed = 0;
  let next = 0;
  lengths.forEach((length, index) => {
    const [ax, ay] = points[index]!;
    const [bx, by] = points[index + 1]!;
    while (next <= passed + length) {
      const k = length === 0 ? 0 : (next - passed) / length;
      samples.push({ x: ax + (bx - ax) * k, y: ay + (by - ay) * k, t: next / total });
      next += step;
    }
    passed += length;
  });
  return samples;
}

/**
 * Точки подписей номеров для всех маршрутов данных (вычисляются один раз: геометрия постоянна).
 * Подпись всегда лежит на линии своего маршрута.
 */
export function routeLabelAnchors(routes: readonly OsmRoute[]): Map<RouteId, LngLat> {
  const grid = new Map<string, { route: RouteId; x: number; y: number }[]>();
  const cell = (x: number, y: number) => `${Math.floor(x / UNIQUE_M)}:${Math.floor(y / UNIQUE_M)}`;
  for (const route of routes) {
    for (const line of route.lines) {
      for (const { x, y } of along(line, SAMPLE_M)) {
        const key = cell(x, y);
        const bucket = grid.get(key) ?? [];
        bucket.push({ route: route.route, x, y });
        grid.set(key, bucket);
      }
    }
  }
  /** Расстояние до ближайшего другого маршрута; дальше UNIQUE_M не ищем. */
  const nearestOther = (route: RouteId, x: number, y: number): number => {
    const cx = Math.floor(x / UNIQUE_M);
    const cy = Math.floor(y / UNIQUE_M);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const sample of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (sample.route !== route) best = Math.min(best, Math.hypot(sample.x - x, sample.y - y));
        }
      }
    }
    return best;
  };

  const anchors = new Map<RouteId, LngLat>();
  const placed: { x: number; y: number }[] = [];
  for (const route of routes) {
    const candidates = route.lines.flatMap((line) => along(line, CANDIDATE_M)).map((sample) => {
      const other = nearestOther(route.route, sample.x, sample.y);
      const apart = placed.every((anchor) => Math.hypot(anchor.x - sample.x, anchor.y - sample.y) >= APART_M);
      return { ...sample, other, unique: other >= UNIQUE_M, apart, centrality: Math.abs(sample.t - 0.5) };
    });
    candidates.sort((a, b) => Number(b.unique) - Number(a.unique) || Number(b.apart) - Number(a.apart) ||
      (a.unique ? 0 : b.other - a.other) || a.centrality - b.centrality);
    const best = candidates[0];
    if (!best) continue;
    placed.push(best);
    anchors.set(route.route, unproject(best.x, best.y));
  }
  return anchors;
}
