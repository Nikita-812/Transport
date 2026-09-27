// Mock-адаптер API для разработки без бекенда (`npm run dev:mock`, design D3).
// Данные СИНТЕТИЧЕСКИЕ: детерминированный профиль будни/выходные с пиками около 8 и 18 ч. Это не прогноз модели.
// Модуль подключается только при `import.meta.env.VITE_API_MOCK === '1'`; сборка проверяет, что маркер
// MOCK_MARKER не попал в static/index.html (scripts/verify_single_file.mjs).
import { setApiTransport, type Transport } from './client';
import { KNOWN_DETAILS } from './errors';
import { ROUTES, SEASONS, isIsoDate, type AggregateGroupBy, type Coverage, type RouteId, type ValidationIssue } from './types';

export const MOCK_MARKER = '__TRAM_API_MOCK__';

export const MOCK_COVERAGE: Coverage = { start: '2025-11-01', end: '2026-10-31' };
export const MOCK_FORECAST_VERSION = 'mock_synthetic:000000000000';

const DAY_MS = 86_400_000;
const COVERAGE_START_MS = utcMs(MOCK_COVERAGE.start);
const COVERAGE_DAYS = Math.round((utcMs(MOCK_COVERAGE.end) - COVERAGE_START_MS) / DAY_MS) + 1;

/** Условный масштаб маршрутов (посадок в пиковый час) — синтетика, только для вида графиков. */
const ROUTE_SCALE: Record<RouteId, number> = { 1: 520, 5: 70, 7: 640, 11: 560, 12: 430, 17: 470, 25: 300, 26: 390, 28: 260, 50: 350 };

function utcMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function gauss(x: number, mean: number, sd: number): number {
  return Math.exp(-((x - mean) ** 2) / (2 * sd * sd));
}

/** Детерминированный шум в [-1; 1] (хэш целых, без Math.random). */
function noise(route: number, day: number, hour: number): number {
  let h = Math.imul(route, 374_761_393) ^ Math.imul(day, 668_265_263) ^ Math.imul(hour + 1, 2_246_822_519);
  h = Math.imul(h ^ (h >>> 13), 1_274_126_177);
  h ^= h >>> 16;
  return ((h >>> 0) / 0xffff_ffff) * 2 - 1;
}

function hourProfile(hour: number, weekend: boolean): number {
  if (weekend) return 0.04 + 0.62 * gauss(hour, 14, 3.6);
  const night = hour >= 1 && hour <= 4 ? 0.15 : 1;
  return night * (0.05 + gauss(hour, 8, 1.2) + 0.9 * gauss(hour, 18, 1.5) + 0.3 * gauss(hour, 13, 3));
}

/** Синтетическое значение «маршрут × день × час»; `dayIndex` отсчитывается от начала покрытия. */
export function mockPrediction(route: RouteId, dayIndex: number, hour: number): number {
  const ms = COVERAGE_START_MS + dayIndex * DAY_MS;
  const weekday = (new Date(ms).getUTCDay() + 6) % 7; // понедельник = 0, как в API
  const dayOfYear = Math.floor((ms - Date.UTC(new Date(ms).getUTCFullYear(), 0, 1)) / DAY_MS);
  const seasonal = 1 + 0.1 * Math.cos((2 * Math.PI * (dayOfYear - 20)) / 365); // зимой выше, летом ниже
  const value = ROUTE_SCALE[route] * hourProfile(hour, weekday >= 5) * seasonal * (1 + 0.06 * noise(route, dayIndex, hour));
  return Math.max(0, Math.round(value * 1e6) / 1e6);
}

// ---------------------------------------------------------------------------
// Мини-справочник: несколько реальных остановок справочника организаторов для маршрутов 1, 5, 7, 11, 12
// (одно направление), чтобы в mock-режиме были общие остановки для проверки карты.

const MOCK_REFERENCE = {
  schema_version: 1,
  source: 'mock: подмножество справочника организаторов',
  forecast_available: false,
  note: 'Reference geometry only; no stop-linked boarding target is available.',
  routes: [
    {
      route: 1,
      trips: [{ trip_id: '2040920', direction: '0', stops: [
        { stop_id: '2594', name: 'Чертаново Южное', lat: 55.59468, lon: 37.590884, sequence: 1 },
        { stop_id: '2599', name: 'Чертаново Центральное', lat: 55.613511, lon: 37.59216, sequence: 8 },
        { stop_id: '2605', name: 'Верхний Чертановский пруд', lat: 55.637743, lon: 37.60526, sequence: 15 },
        { stop_id: '2612', name: 'Москворецкий рынок', lat: 55.65841, lon: 37.608629, sequence: 22 },
      ] }],
    },
    {
      route: 5,
      trips: [{ trip_id: '2035712', direction: '0', stops: [
        { stop_id: '22101', name: 'Метро "Рижская"', lat: 55.792739, lon: 37.63413, sequence: 1 },
        { stop_id: '1000594', name: 'МИИТ', lat: 55.788886, lon: 37.610106, sequence: 6 },
        { stop_id: '16606', name: 'Улица Палиха', lat: 55.784825, lon: 37.600696, sequence: 11 },
        { stop_id: '1001795', name: 'Белорусский вокзал', lat: 55.776346, lon: 37.583435, sequence: 16 },
      ] }],
    },
    {
      route: 7,
      trips: [{ trip_id: '2042578', direction: '0', stops: [
        { stop_id: '8605', name: 'Метро "Бульвар Рокоссовского"', lat: 55.814259, lon: 37.734183, sequence: 1 },
        { stop_id: '6242', name: 'Преображенская площадь', lat: 55.795248, lon: 37.709279, sequence: 16 },
        { stop_id: '13919', name: 'Метро "Комсомольская"', lat: 55.775528, lon: 37.656232, sequence: 24 },
        { stop_id: '16514', name: 'Спорткомплекс "Олимпийский"', lat: 55.780739, lon: 37.632351, sequence: 31 },
        { stop_id: '1001795', name: 'Белорусский вокзал', lat: 55.776346, lon: 37.583435, sequence: 45 },
      ] }],
    },
    {
      route: 11,
      trips: [{ trip_id: '2043371', direction: '0', stops: [
        { stop_id: '6152', name: 'Усадьба Останкино', lat: 55.822781, lon: 37.617058, sequence: 1 },
        { stop_id: '1001713', name: 'Богатырский мост', lat: 55.816722, lon: 37.689073, sequence: 15 },
        { stop_id: '3622', name: 'Метро "Семёновская"', lat: 55.782153, lon: 37.720085, sequence: 27 },
        { stop_id: '3623', name: 'Улица Ибрагимова', lat: 55.782588, lon: 37.731124, sequence: 28 },
        { stop_id: '10463', name: 'Восточное Измайлово', lat: 55.794481, lon: 37.822687, sequence: 42 },
      ] }],
    },
    {
      route: 12,
      trips: [{ trip_id: '2043157', direction: '0', stops: [
        { stop_id: '10463', name: 'Восточное Измайлово', lat: 55.794481, lon: 37.822687, sequence: 1 },
        { stop_id: '3645', name: 'Улица Ибрагимова', lat: 55.78269, lon: 37.730053, sequence: 16 },
        { stop_id: '3646', name: 'Метро "Семёновская"', lat: 55.782389, lon: 37.72187, sequence: 17 },
        { stop_id: '15496', name: 'Старообрядческая улица', lat: 55.747867, lon: 37.694823, sequence: 34 },
        { stop_id: '8439', name: 'МЦК Дубровка', lat: 55.714214, lon: 37.678501, sequence: 50 },
      ] }],
    },
  ],
};

// ---------------------------------------------------------------------------
// Обработка запросов: тот же порядок проверок и те же ответы об ошибках, что у forecast_api.py.

class HttpError extends Error {
  constructor(readonly status: number, readonly detail: string | ValidationIssue[]) {
    super(typeof detail === 'string' ? detail : 'validation error');
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function csv(text: string, filename: string): Response {
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename=${filename}` },
  });
}

function parseRoutesParam(value: string): RouteId[] {
  const numbers = value.split(',').map((item) => item.trim());
  if (numbers.some((item) => !/^[+-]?\d+$/.test(item))) throw new HttpError(422, KNOWN_DETAILS.badRoutes);
  const unique = [...new Set(numbers.map(Number))].sort((a, b) => a - b);
  if (unique.length === 0 || unique.some((route) => !(ROUTES as readonly number[]).includes(route))) {
    throw new HttpError(422, KNOWN_DETAILS.unsupportedRoute);
  }
  return unique as RouteId[];
}

interface ParsedQuery {
  routes: RouteId[];
  start: string;
  end: string;
  hour: number | null;
  groupBy: string;
}

function parseQuery(params: URLSearchParams): ParsedQuery {
  // 1. Валидация параметров FastAPI → списочный detail.
  const issues: ValidationIssue[] = [];
  const intIssue = (name: string, input: string): ValidationIssue => ({
    type: 'int_parsing',
    loc: ['query', name],
    msg: 'Input should be a valid integer, unable to parse string as an integer',
    input,
  });
  const route = params.get('route');
  if (route !== null && !/^[+-]?\d+$/.test(route.trim())) issues.push(intIssue('route', route));
  for (const name of ['start_date', 'end_date'] as const) {
    const value = params.get(name);
    if (value === null) issues.push({ type: 'missing', loc: ['query', name], msg: 'Field required', input: null });
    else if (!isIsoDate(value)) {
      issues.push({ type: 'date_from_datetime_parsing', loc: ['query', name], msg: 'Input should be a valid date or datetime', input: value });
    }
  }
  const hourText = params.get('hour');
  if (hourText !== null && !/^[+-]?\d+$/.test(hourText.trim())) issues.push(intIssue('hour', hourText));
  if (issues.length > 0) throw new HttpError(422, issues);

  // 2. Выбор маршрутов.
  if (params.has('stop_id')) throw new HttpError(422, KNOWN_DETAILS.stopsUnavailable);
  const routesText = params.get('routes');
  let routes: RouteId[];
  if (routesText !== null) routes = parseRoutesParam(routesText);
  else if (route !== null) routes = parseRoutesParam(String(Number(route)));
  else throw new HttpError(422, KNOWN_DETAILS.routeRequired);

  // 3. Диапазон, час, группировка.
  const start = params.get('start_date') as string;
  const end = params.get('end_date') as string;
  if (start < MOCK_COVERAGE.start || end > MOCK_COVERAGE.end || start > end) throw new HttpError(422, KNOWN_DETAILS.outsideCoverage);
  const hour = hourText === null ? null : Number(hourText);
  if (hour !== null && (hour < 0 || hour > 23)) throw new HttpError(422, KNOWN_DETAILS.badHour);
  const groupBy = params.get('group_by') ?? 'raw';
  if (!['raw', 'hour', 'day', 'week', 'month', 'weekday', 'season'].includes(groupBy)) throw new HttpError(422, KNOWN_DETAILS.badGroupBy);
  return { routes, start, end, hour, groupBy };
}

interface MockRow {
  route: RouteId;
  date: string;
  hour: number;
  prediction: number;
}

function rawRows(query: ParsedQuery): MockRow[] {
  const first = Math.round((utcMs(query.start) - COVERAGE_START_MS) / DAY_MS);
  const last = Math.round((utcMs(query.end) - COVERAGE_START_MS) / DAY_MS);
  const rows: MockRow[] = [];
  for (const route of query.routes) {
    for (let day = first; day <= last; day += 1) {
      const date = isoFromMs(COVERAGE_START_MS + day * DAY_MS);
      for (let hour = 0; hour < 24; hour += 1) {
        if (query.hour === null || query.hour === hour) rows.push({ route, date, hour, prediction: mockPrediction(route, day, hour) });
      }
    }
  }
  return rows;
}

function isoWeekKey(date: string): string {
  const ms = utcMs(date);
  const weekday = (new Date(ms).getUTCDay() + 6) % 7;
  const thursday = new Date(ms + (3 - weekday) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * DAY_MS)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function bucketKey(row: MockRow, groupBy: AggregateGroupBy): string {
  switch (groupBy) {
    case 'hour':
      return `${String(row.hour).padStart(2, '0')}:00`;
    case 'day':
      return row.date;
    case 'week':
      return isoWeekKey(row.date);
    case 'month':
      return row.date.slice(0, 7);
    case 'weekday':
      return String((new Date(utcMs(row.date)).getUTCDay() + 6) % 7);
    case 'season':
      return SEASONS[Math.floor((Number(row.date.slice(5, 7)) % 12) / 3)] as string;
  }
}

function aggregate(rows: MockRow[], groupBy: AggregateGroupBy): Record<string, string | number>[] {
  const sums = new Map<string, number>();
  for (const row of rows) {
    const key = bucketKey(row, groupBy);
    sums.set(key, (sums.get(key) ?? 0) + row.prediction);
  }
  return [...sums.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, prediction]) => ({ [groupBy]: key, prediction }));
}

function queryRows(query: ParsedQuery): Record<string, string | number>[] {
  const rows = rawRows(query);
  return query.groupBy === 'raw' ? rows.map((row) => ({ ...row })) : aggregate(rows, query.groupBy as AggregateGroupBy);
}

function toCsv(rows: Record<string, string | number>[], fallbackHeader: string[]): string {
  const header = rows[0] ? Object.keys(rows[0]) : fallbackHeader;
  const lines = [header.join(';'), ...rows.map((row) => header.map((key) => String(row[key])).join(';'))];
  return `${lines.join('\n')}\n`;
}

/** Синхронный обработчик запроса к синтетическому сервису. */
export function handleMockRequest(input: string): Response {
  const url = new URL(input, 'http://mock.local');
  try {
    switch (url.pathname) {
      case '/health':
        return json(200, { ready: true, forecast_version: MOCK_FORECAST_VERSION, quality_passed: false, serving_mode: 'diagnostic', coverage: MOCK_COVERAGE });
      case '/forecasts': {
        const query = parseQuery(url.searchParams);
        return json(200, { forecast_version: MOCK_FORECAST_VERSION, routes: query.routes, group_by: query.groupBy, rows: queryRows(query) });
      }
      case '/forecasts/export.csv':
        return csv(toCsv(queryRows(parseQuery(url.searchParams)), ['route', 'date', 'hour', 'prediction']), 'forecasts.csv');
      case '/forecasts.csv':
        return csv(
          toCsv(rawRows({ routes: [...ROUTES], start: MOCK_COVERAGE.start, end: '2025-12-31', hour: null, groupBy: 'raw' }).map((row) => ({ ...row })), []),
          'forecast.csv',
        );
      case '/reference-map':
        return json(200, MOCK_REFERENCE);
      default:
        return json(404, { detail: 'Not Found' });
    }
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { detail: error.detail });
    throw error;
  }
}

export interface MockTransportOptions {
  /** Искусственная задержка ответа, мс: видно состояние загрузки. */
  latencyMs?: number;
}

export function createMockTransport({ latencyMs = 0 }: MockTransportOptions = {}): Transport {
  return (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init?.signal ?? undefined;
      const abortError = () => new DOMException('The operation was aborted.', 'AbortError');
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        try {
          resolve(handleMockRequest(input));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }, latencyMs);
      function onAbort() {
        clearTimeout(timer);
        reject(abortError());
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });
}

/** Включает mock-адаптер для всего клиента API. Вызывается из main.tsx только в mock-режиме. */
export function installMockApi(): void {
  setApiTransport(createMockTransport({ latencyMs: 250 }));
  console.info(`[${MOCK_MARKER}] Включён mock API: синтетические данные, ${COVERAGE_DAYS} дней покрытия. Это не прогноз модели.`);
}
