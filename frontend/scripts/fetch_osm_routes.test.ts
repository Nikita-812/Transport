import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildRoutes, finalizeOutput, formatOutput, QUERY, relationStops, roundLine, simplifyLine, stitchWays, validateRoutes, ROUTES,
} from './fetch_osm_routes.mjs';

type Position = [number, number];
type Relation = Parameters<typeof relationStops>[0];
type Member = Relation['members'][number];
type OsmRoutes = Parameters<typeof validateRoutes>[0];
const p = (lon: number, lat: number): Position => [lon, lat];

describe('склейка путей', () => {
  it('пути по порядку продолжают отрезок', () => {
    expect(stitchWays([[p(0, 0), p(1, 0)], [p(1, 0), p(2, 0)]])).toEqual([[p(0, 0), p(1, 0), p(2, 0)]]);
  });

  it('путь, стыкующийся концом, разворачивается', () => {
    expect(stitchWays([[p(0, 0), p(1, 0)], [p(2, 0), p(1, 0)]])).toEqual([[p(0, 0), p(1, 0), p(2, 0)]]);
  });

  it('первый путь разворачивается, если следующий примыкает к его началу', () => {
    expect(stitchWays([[p(1, 0), p(0, 0)], [p(1, 0), p(2, 0)]])).toEqual([[p(0, 0), p(1, 0), p(2, 0)]]);
    expect(stitchWays([[p(1, 0), p(0, 0)], [p(2, 0), p(1, 0)]])).toEqual([[p(0, 0), p(1, 0), p(2, 0)]]);
  });

  it('разрыв начинает новый отрезок', () => {
    expect(stitchWays([[p(0, 0), p(1, 0)], [p(5, 5), p(6, 5)], [p(6, 5), p(7, 5)]]))
      .toEqual([[p(0, 0), p(1, 0)], [p(5, 5), p(6, 5), p(7, 5)]]);
  });

  it('вырожденные пути пропускаются', () => {
    expect(stitchWays([[p(0, 0)], [p(0, 0), p(1, 0)]])).toEqual([[p(0, 0), p(1, 0)]]);
  });
});

describe('координаты', () => {
  it('5 знаков после точки, повторы после округления удаляются', () => {
    expect(roundLine([p(37.123456, 55.654321), p(37.1234561, 55.6543212), p(37.2, 55.7)]))
      .toEqual([p(37.12346, 55.65432), p(37.2, 55.7)]);
  });

  it('Дуглас — Пекер убирает точки ближе допуска и сохраняет изгибы', () => {
    const almostStraight = [p(37.6, 55.75), p(37.6005, 55.75 + 0.00001), p(37.601, 55.75)];
    expect(simplifyLine(almostStraight, 5)).toEqual([p(37.6, 55.75), p(37.601, 55.75)]);
    const corner = [p(37.6, 55.75), p(37.601, 55.75), p(37.601, 55.751)];
    expect(simplifyLine(corner, 5)).toEqual(corner);
  });
});

const relation = (id: number, ref: number, members: Member[]): Relation => ({
  type: 'relation', id, tags: { ref: String(ref), name: `Трамвай ${ref}`, from: 'А', to: 'Б' }, members,
});

describe('остановки', () => {
  const tags = new Map<number, Record<string, string>>([
    [1, { name: 'Метро «Комсомольская»' }],
    [2, {}],
    [3, { name: 'Платформа у депо' }],
    [4, { name: 'Конечная' }],
  ]);

  it('узлы с ролями stop, stop_entry_only и stop_exit_only; имя без узла берётся у платформы', () => {
    const stops = relationStops(relation(10, 50, [
      { type: 'node', ref: 1, role: 'stop_entry_only', lat: 55.776543, lon: 37.654321 },
      { type: 'way', ref: 100, role: 'platform', geometry: [] },
      { type: 'node', ref: 2, role: 'stop', lat: 55.78, lon: 37.66 },
      { type: 'node', ref: 3, role: 'platform', lat: 55.7801, lon: 37.6601 },
      { type: 'node', ref: 4, role: 'stop_exit_only', lat: 55.79, lon: 37.67 },
      { type: 'node', ref: 5, role: 'platform_exit_only', lat: 55.79, lon: 37.67 },
    ]), tags);
    expect(stops).toEqual([
      { id: 'node/1', name: 'Метро «Комсомольская»', lat: 55.77654, lon: 37.65432 },
      { id: 'node/2', name: 'Платформа у депо', lat: 55.78, lon: 37.66 },
      { id: 'node/4', name: 'Конечная', lat: 55.79, lon: 37.67 },
    ]);
  });

  it('остановка без имени пропускается с предупреждением', () => {
    const warnings: string[] = [];
    const stops = relationStops(relation(11, 50, [{ type: 'node', ref: 2, role: 'stop', lat: 55.78, lon: 37.66 }]), tags, (message) => warnings.push(message));
    expect(stops).toEqual([]);
    expect(warnings[0]).toContain('node/2');
  });

  it('остановки двух направлений дедуплицируются по узлу, линии склеиваются по направлениям', () => {
    const forward = relation(20, 17, [
      { type: 'node', ref: 1, role: 'stop', lat: 55.77, lon: 37.65 },
      { type: 'way', ref: 200, role: '', geometry: [{ lat: 55.77, lon: 37.65 }, { lat: 55.78, lon: 37.66 }] },
      { type: 'way', ref: 201, role: '', geometry: [{ lat: 55.79, lon: 37.67 }, { lat: 55.78, lon: 37.66 }] },
      { type: 'node', ref: 4, role: 'stop', lat: 55.79, lon: 37.67 },
    ]);
    const backward = relation(21, 17, [
      { type: 'node', ref: 4, role: 'stop', lat: 55.79, lon: 37.67 },
      { type: 'way', ref: 202, role: '', geometry: [{ lat: 55.79, lon: 37.67 }, { lat: 55.77, lon: 37.65 }] },
      { type: 'node', ref: 1, role: 'stop', lat: 55.77, lon: 37.65 },
    ]);
    const routes = buildRoutes([backward, forward], tags);
    const route17 = routes.find((route) => route.route === 17)!;
    expect(route17.relations.map((item) => item.id)).toEqual([20, 21]);
    expect(route17.stops.map((stop) => stop.id)).toEqual(['node/1', 'node/4']);
    expect(route17.lines).toEqual([[p(37.65, 55.77), p(37.66, 55.78), p(37.67, 55.79)], [p(37.67, 55.79), p(37.65, 55.77)]]);
    // Остальных маршрутов в ответе нет: такой результат не должен заменить рабочий файл.
    expect(validateRoutes(routes)).toContain('маршрут 1: нет линий');
    expect(validateRoutes(routes).some((problem) => problem.startsWith('маршрут 17'))).toBe(false);
  });
});

describe('закоммиченный src/data/osm-routes.json', () => {
  // Тесты запускаются из frontend/.
  const file = JSON.parse(readFileSync(path.resolve(process.cwd(), 'src/data/osm-routes.json'), 'utf8')) as {
    license: string; attribution: string; source: string; fetched_at: string; routes: OsmRoutes;
  };

  it('10 маршрутов, у каждого два направления, линии и остановки', () => {
    expect(file.routes.map((route) => route.route)).toEqual(ROUTES);
    for (const route of file.routes) {
      expect(route.relations).toHaveLength(2);
      expect(route.lines.length).toBeGreaterThan(0);
      expect(route.stops.length).toBeGreaterThan(10);
      expect(route.stops.every((stop) => stop.name.length > 0 && stop.id.startsWith('node/'))).toBe(true);
    }
    expect(validateRoutes(file.routes)).toEqual([]);
  });

  it('метаданные источника и лицензии', () => {
    expect(file).toMatchObject({ source: 'OpenStreetMap via Overpass API', license: 'ODbL 1.0', attribution: '© OpenStreetMap contributors' });
    expect(Number.isNaN(Date.parse(file.fetched_at))).toBe(false);
  });

  it('координаты — не больше 5 знаков после точки', () => {
    const decimals = (value: number) => (String(value).split('.')[1] ?? '').length;
    const values = file.routes.flatMap((route) => route.lines.flat(2));
    expect(values.every((value) => decimals(value) <= 5)).toBe(true);
  });
});

describe('запрос и файл', () => {
  it('один запрос: relation с геометрией и теги узлов-членов из одного снимка базы', () => {
    expect(QUERY).toContain('relation["type"="route"]["route"="tram"]["ref"~"^(1|5|7|11|12|17|25|26|28|50)$"](55.49,37.30,56.00,37.97)->.r;');
    expect(QUERY).toContain('.r out geom;node(r.r);out;');
    expect(QUERY.startsWith('[out:json]')).toBe(true);
  });

  it('JSON для diff остаётся корректным и не упрощается до 400 КБ', () => {
    const routes = ROUTES.map((route) => ({
      route, relations: [{ id: route, name: `Трамвай ${route}`, from: 'А', to: 'Б' }],
      lines: [[p(37.6, 55.7), p(37.61, 55.71)]], stops: [{ id: `node/${route}`, name: 'Остановка', lat: 55.7, lon: 37.6 }],
    }));
    const { data, text } = finalizeOutput({
      source: 'OpenStreetMap via Overpass API', license: 'ODbL 1.0', attribution: '© OpenStreetMap contributors',
      fetched_at: '2026-09-27T00:00:00.000Z', osm_base: null, endpoint: 'https://example.test', routes,
    });
    expect(data.simplified).toBeNull();
    expect(JSON.parse(text)).toEqual(data);
    expect(formatOutput(data).split('\n')).toContain('        [[37.6,55.7],[37.61,55.71]]');
  });
});
