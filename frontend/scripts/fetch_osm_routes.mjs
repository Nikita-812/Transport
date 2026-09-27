#!/usr/bin/env node
// Геометрия путей и остановки 10 трамвайных маршрутов из OpenStreetMap (design D9 и D0)
// → src/data/osm-routes.json. Файл закоммичен и вшит в сборку; скрипт нужен только для обновления.
//
//   node scripts/fetch_osm_routes.mjs [--out <путь>]
//
// Node без зависимостей. Зеркала Overpass перебираются по очереди: POST с полем data, User-Agent проекта,
// таймаут 120 с; после круга неудач — пауза и новый круг. Файл записывается только после проверки
// результата, поэтому при полной неудаче существующий файл остаётся прежним.
import { renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * @typedef {[number, number]} Position  долгота и широта, как в GeoJSON
 * @typedef {{ type: string; ref: number; role: string; lat?: number; lon?: number; geometry?: { lat: number; lon: number }[] }} OverpassMember
 * @typedef {{ type: 'relation'; id: number; tags?: Record<string, string>; members: OverpassMember[] }} OverpassRelation
 * @typedef {{ type: string; id: number; tags?: Record<string, string> }} OverpassElement
 * @typedef {{ elements: OverpassElement[]; remark?: string; osm3s?: { timestamp_osm_base?: string } }} OverpassResponse
 * @typedef {{ id: string; name: string; lat: number; lon: number }} OsmStop
 * @typedef {{ id: number; name: string; from: string; to: string }} OsmRelationInfo
 * @typedef {{ route: number; relations: OsmRelationInfo[]; lines: Position[][]; stops: OsmStop[] }} OsmRoute
 * @typedef {{ source: string; license: string; attribution: string; fetched_at: string; osm_base: string | null;
 *   endpoint: string; simplified: null | { tolerance_m: number }; routes: OsmRoute[] }} OsmRoutesFile
 */

export const ROUTES = [1, 5, 7, 11, 12, 17, 25, 26, 28, 50];

export const ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export const USER_AGENT = 'tram-forecast-dashboard/0.1 (Moscow tram passenger forecast; OSM route geometry update)';
const TIMEOUT_MS = 120_000;
const ROUNDS = 3;
const ROUND_PAUSE_MS = 20_000;

/** bbox Москвы: фильтр по имени области ломается на кодировках (design D9). */
export const BBOX = { south: 55.49, west: 37.3, north: 56.0, east: 37.97 };

/**
 * Оба запроса D9 в одном: relation с геометрией членов (`out geom`), затем теги узлов-членов
 * (`node(r.r); out`). Зеркала живут в разных состояниях базы, и теги, взятые с другого зеркала,
 * не совпадают с его relation (так остановки теряли имена), поэтому нужен один снимок.
 */
export const QUERY =
  `[out:json][timeout:110];relation["type"="route"]["route"="tram"]["ref"~"^(${ROUTES.join('|')})$"]` +
  `(${BBOX.south.toFixed(2)},${BBOX.west.toFixed(2)},${BBOX.north.toFixed(2)},${BBOX.east.toFixed(2)})->.r;` +
  '.r out geom;node(r.r);out;';

const STOP_ROLES = new Set(['stop', 'stop_entry_only', 'stop_exit_only']);
const PLATFORM_ROLES = new Set(['platform', 'platform_entry_only', 'platform_exit_only']);

/** Упрощение Дугласом — Пекером — только если файл больше 400 КБ (design D0). */
export const SIMPLIFY_THRESHOLD_BYTES = 400 * 1024;
export const SIMPLIFY_TOLERANCE_M = 5;

/** Пять знаков после точки: около 1 м. */
export function round5(/** @type {number} */ value) {
  return Math.round(value * 1e5) / 1e5;
}

/**
 * @param {Position} a
 * @param {Position} b
 */
function samePoint(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Склейка путей relation в последовательные отрезки (MultiLineString). Пути с пустой ролью идут по порядку
 * маршрута: путь разворачивается, если стыкуется концом; первый путь отрезка разворачивается, если следующий
 * примыкает к его началу; при разрыве начинается новый отрезок.
 * @param {readonly (readonly Position[])[]} ways
 * @returns {Position[][]}
 */
export function stitchWays(ways) {
  /** @type {Position[][]} */
  const segments = [];
  /** @type {Position[] | null} */
  let current = null;
  let single = false;
  for (const way of ways) {
    if (way.length < 2) continue;
    const first = /** @type {Position} */ (way[0]);
    const last = /** @type {Position} */ (way[way.length - 1]);
    if (!current) {
      current = [...way];
      single = true;
      continue;
    }
    const head = /** @type {Position} */ (current[0]);
    const tail = /** @type {Position} */ (current[current.length - 1]);
    if (samePoint(first, tail)) current.push(...way.slice(1));
    else if (samePoint(last, tail)) current.push(...[...way].reverse().slice(1));
    else if (single && samePoint(first, head)) { current.reverse(); current.push(...way.slice(1)); }
    else if (single && samePoint(last, head)) { current.reverse(); current.push(...[...way].reverse().slice(1)); }
    else {
      segments.push(current);
      current = [...way];
      single = true;
      continue;
    }
    single = false;
  }
  if (current) segments.push(current);
  return segments;
}

/**
 * Координаты с 5 знаками; соседние совпавшие после округления точки удаляются.
 * @param {readonly Position[]} line
 * @returns {Position[]}
 */
export function roundLine(line) {
  /** @type {Position[]} */
  const result = [];
  for (const [lon, lat] of line) {
    const point = /** @type {Position} */ ([round5(lon), round5(lat)]);
    const previous = result[result.length - 1];
    if (!previous || !samePoint(previous, point)) result.push(point);
  }
  return result;
}

/**
 * Дуглас — Пекер в локальной равнопромежуточной проекции (метры).
 * @param {readonly Position[]} line
 * @param {number} toleranceM
 * @returns {Position[]}
 */
export function simplifyLine(line, toleranceM) {
  if (line.length <= 2) return [...line];
  const lat0 = (line.reduce((sum, point) => sum + point[1], 0) / line.length) * (Math.PI / 180);
  const kx = 111_320 * Math.cos(lat0);
  const ky = 110_540;
  const xs = Float64Array.from(line, (point) => point[0] * kx);
  const ys = Float64Array.from(line, (point) => point[1] * ky);
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  /** @type {[number, number][]} */
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [from, to] = /** @type {[number, number]} */ (stack.pop());
    const ax = xs[from] ?? 0;
    const ay = ys[from] ?? 0;
    const dx = (xs[to] ?? 0) - ax;
    const dy = (ys[to] ?? 0) - ay;
    const length2 = dx * dx + dy * dy;
    let worst = -1;
    let worstDistance = 0;
    for (let index = from + 1; index < to; index++) {
      const vx = (xs[index] ?? 0) - ax;
      const vy = (ys[index] ?? 0) - ay;
      const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, (vx * dx + vy * dy) / length2));
      const distance = Math.hypot(vx - t * dx, vy - t * dy);
      if (distance > worstDistance) { worstDistance = distance; worst = index; }
    }
    if (worst !== -1 && worstDistance > toleranceM) {
      keep[worst] = 1;
      stack.push([from, worst], [worst, to]);
    }
  }
  return line.filter((_, index) => keep[index] === 1);
}

/**
 * Остановки направления: узлы с ролями stop, stop_entry_only, stop_exit_only и их name.
 * Если у узла нет имени — имя платформы-узла, идущей за ним до следующей остановки (PTv2: stop, platform).
 * @param {OverpassRelation} relation
 * @param {ReadonlyMap<number, Record<string, string>>} nodeTags
 * @param {(message: string) => void} [warn]
 * @returns {OsmStop[]}
 */
export function relationStops(relation, nodeTags, warn = () => {}) {
  /** @type {OsmStop[]} */
  const stops = [];
  relation.members.forEach((member, index) => {
    if (member.type !== 'node' || !STOP_ROLES.has(member.role)) return;
    let name = nodeTags.get(member.ref)?.name?.trim();
    if (!name) {
      for (const next of relation.members.slice(index + 1)) {
        if (STOP_ROLES.has(next.role)) break;
        if (next.type === 'node' && PLATFORM_ROLES.has(next.role)) {
          name = nodeTags.get(next.ref)?.name?.trim();
          if (name) break;
        }
      }
    }
    if (member.lat === undefined || member.lon === undefined) {
      warn(`relation ${relation.id}: у остановки node/${member.ref} нет координат — пропущена`);
      return;
    }
    if (!name) {
      warn(`relation ${relation.id}: у остановки node/${member.ref} нет имени — пропущена`);
      return;
    }
    stops.push({ id: `node/${member.ref}`, name, lat: round5(member.lat), lon: round5(member.lon) });
  });
  return stops;
}

/**
 * Пути relation с пустой ролью в порядке маршрута, координаты [lon, lat].
 * @param {OverpassRelation} relation
 * @returns {Position[][]}
 */
export function relationWays(relation) {
  return relation.members
    .filter((member) => member.type === 'way' && member.role === '' && Array.isArray(member.geometry))
    .map((member) => (member.geometry ?? []).map((point) => /** @type {Position} */ ([point.lon, point.lat])));
}

/**
 * Маршруты из ответов Overpass: линии направлений склеены, остановки направлений дедуплицированы.
 * @param {readonly OverpassRelation[]} relations
 * @param {ReadonlyMap<number, Record<string, string>>} nodeTags
 * @param {(message: string) => void} [warn]
 * @returns {OsmRoute[]}
 */
export function buildRoutes(relations, nodeTags, warn = () => {}) {
  return ROUTES.map((route) => {
    const own = relations.filter((relation) => relation.tags?.ref === String(route)).sort((a, b) => a.id - b.id);
    if (own.length !== 2) warn(`маршрут ${route}: relation ${own.length}, ожидалось 2 (по одному на направление)`);
    /** @type {OsmStop[]} */
    const stops = [];
    const seen = new Set();
    for (const relation of own) {
      for (const stop of relationStops(relation, nodeTags, warn)) {
        if (seen.has(stop.id)) continue;
        seen.add(stop.id);
        stops.push(stop);
      }
    }
    return {
      route,
      relations: own.map((relation) => ({
        id: relation.id,
        name: relation.tags?.name ?? '',
        from: relation.tags?.from ?? '',
        to: relation.tags?.to ?? '',
      })),
      lines: own.flatMap((relation) => stitchWays(relationWays(relation)))
        .map(roundLine)
        .filter((line) => line.length >= 2),
      stops,
    };
  });
}

/**
 * Проверка перед записью: пустой или странный результат не должен заменить рабочий файл.
 * @param {readonly OsmRoute[]} routes
 * @returns {string[]}
 */
export function validateRoutes(routes) {
  const problems = [];
  const inside = (/** @type {number} */ lon, /** @type {number} */ lat) =>
    lat >= BBOX.south && lat <= BBOX.north && lon >= BBOX.west && lon <= BBOX.east;
  for (const route of ROUTES) {
    const item = routes.find((candidate) => candidate.route === route);
    if (!item) { problems.push(`нет маршрута ${route}`); continue; }
    if (!item.relations.length) problems.push(`маршрут ${route}: нет relation`);
    if (!item.lines.length) problems.push(`маршрут ${route}: нет линий`);
    if (item.stops.length < 2) problems.push(`маршрут ${route}: меньше двух остановок`);
    if (item.lines.some((line) => line.some(([lon, lat]) => !inside(lon, lat)))) problems.push(`маршрут ${route}: линия вне bbox Москвы`);
    if (item.stops.some((stop) => !inside(stop.lon, stop.lat))) problems.push(`маршрут ${route}: остановка вне bbox Москвы`);
  }
  return problems;
}

/**
 * JSON, удобный для diff: метаданные с отступами, одна остановка и один отрезок линии на строку.
 * @param {OsmRoutesFile} data
 */
export function formatOutput(data) {
  const { routes, ...meta } = data;
  const header = JSON.stringify(meta, null, 2).slice(0, -2);
  const body = routes.map((route) => [
    '    {',
    `      "route": ${route.route},`,
    '      "relations": [',
    route.relations.map((relation) => `        ${JSON.stringify(relation)}`).join(',\n'),
    '      ],',
    '      "stops": [',
    route.stops.map((stop) => `        ${JSON.stringify(stop)}`).join(',\n'),
    '      ],',
    '      "lines": [',
    route.lines.map((line) => `        ${JSON.stringify(line)}`).join(',\n'),
    '      ]',
    '    }',
  ].join('\n')).join(',\n');
  return `${header},\n  "routes": [\n${body}\n  ]\n}\n`;
}

/**
 * Результат с упрощением линий, если файл без него больше порога (design D0).
 * @param {Omit<OsmRoutesFile, 'simplified'>} data
 * @returns {{ data: OsmRoutesFile; text: string }}
 */
export function finalizeOutput(data) {
  const plain = { ...data, simplified: null };
  const text = formatOutput(plain);
  if (Buffer.byteLength(text, 'utf8') <= SIMPLIFY_THRESHOLD_BYTES) return { data: plain, text };
  const simplified = {
    ...data,
    simplified: { tolerance_m: SIMPLIFY_TOLERANCE_M },
    routes: data.routes.map((route) => ({ ...route, lines: route.lines.map((line) => simplifyLine(line, SIMPLIFY_TOLERANCE_M)) })),
  };
  return { data: simplified, text: formatOutput(simplified) };
}

/**
 * Один запрос к одному зеркалу. Ответ с `remark` о runtime error считается ошибкой: данные в нём неполные.
 * @param {string} endpoint
 * @param {string} query
 * @returns {Promise<OverpassResponse>}
 */
async function overpass(endpoint, query) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Accept: 'application/json' },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)}`);
  /** @type {OverpassResponse} */
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`ответ не JSON: ${text.slice(0, 120)}`);
  }
  if (!Array.isArray(body.elements)) throw new Error('в ответе нет elements');
  if (body.remark && /error|timed out/i.test(body.remark)) throw new Error(`remark: ${body.remark}`);
  return body;
}

/**
 * Зеркала по очереди, затем пауза и новый круг: зеркала часто отвечают 504 при перегрузке.
 * @param {string} query
 * @param {string} label
 * @returns {Promise<{ body: OverpassResponse; endpoint: string }>}
 */
async function queryMirrors(query, label) {
  const errors = [];
  for (let round = 1; round <= ROUNDS; round++) {
    for (const endpoint of ENDPOINTS) {
      const started = Date.now();
      try {
        const body = await overpass(endpoint, query);
        console.info(`${label}: ${endpoint} — ${body.elements.length} элементов за ${((Date.now() - started) / 1000).toFixed(1)} с`);
        return { body, endpoint };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${endpoint}: ${message}`);
        console.warn(`${label}: круг ${round}, ${endpoint} — ${message}`);
      }
    }
    if (round < ROUNDS) await new Promise((resolve) => setTimeout(resolve, ROUND_PAUSE_MS * round));
  }
  throw new Error(`${label}: все зеркала Overpass недоступны\n  ${errors.join('\n  ')}`);
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outIndex = process.argv.indexOf('--out');
  const target = path.resolve(process.cwd(), outIndex !== -1 && process.argv[outIndex + 1]
    ? String(process.argv[outIndex + 1])
    : path.join(here, '..', 'src', 'data', 'osm-routes.json'));

  const { body, endpoint } = await queryMirrors(QUERY, 'relation, геометрия и теги узлов');
  const relations = /** @type {OverpassRelation[]} */ (body.elements.filter((element) => element.type === 'relation'));
  const nodeTags = new Map(body.elements.filter((element) => element.type === 'node').map((element) => [element.id, element.tags ?? {}]));

  /** @type {string[]} */
  const warnings = [];
  const routes = buildRoutes(relations, nodeTags, (message) => warnings.push(message));
  for (const warning of warnings) console.warn(`предупреждение: ${warning}`);
  const problems = validateRoutes(routes);
  if (problems.length) {
    console.error(`fetch_osm_routes: результат не прошёл проверку, ${path.relative(process.cwd(), target)} не изменён:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  const { data, text } = finalizeOutput({
    source: 'OpenStreetMap via Overpass API',
    license: 'ODbL 1.0',
    attribution: '© OpenStreetMap contributors',
    fetched_at: new Date().toISOString(),
    osm_base: body.osm3s?.timestamp_osm_base ?? null,
    endpoint,
    routes,
  });
  // Запись через временный файл рядом: прерванный скрипт не оставит половину JSON.
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, target);
  const points = data.routes.reduce((sum, route) => sum + route.lines.reduce((acc, line) => acc + line.length, 0), 0);
  const stops = data.routes.reduce((sum, route) => sum + route.stops.length, 0);
  console.info(`fetch_osm_routes: ${path.relative(process.cwd(), target)} — ${data.routes.length} маршрутов, ${points} точек линий, ` +
    `${stops} остановок, ${(Buffer.byteLength(text, 'utf8') / 1024).toFixed(1)} КБ${data.simplified ? `, упрощение ${data.simplified.tolerance_m} м` : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`fetch_osm_routes: ${error instanceof Error ? error.message : String(error)}`);
    console.error('Существующий файл не изменён.');
    process.exit(1);
  });
}
