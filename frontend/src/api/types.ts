// Наблюдаемый контракт API (design, «Контракт API»). Бекенд не меняется, поэтому ответы
// проверяются при разборе: расхождение с контрактом даёт понятную ошибку, а не NaN в графиках.

export const ROUTES = [1, 5, 7, 11, 12, 17, 25, 26, 28, 50] as const;
export type RouteId = (typeof ROUTES)[number];

export const GROUP_BY = ['raw', 'hour', 'day', 'week', 'month', 'weekday', 'season'] as const;
export type GroupBy = (typeof GROUP_BY)[number];
export type AggregateGroupBy = Exclude<GroupBy, 'raw'>;

export const SEASONS = ['winter', 'spring', 'summer', 'autumn'] as const;
export type Season = (typeof SEASONS)[number];

/** Дата в формате `YYYY-MM-DD` без часового пояса (design D5). */
export type IsoDate = string;

export type ServingMode = 'production' | 'diagnostic';

export interface Coverage {
  start: IsoDate;
  end: IsoDate;
}

/** `GET /health` у готового сервиса. */
export interface HealthReady {
  ready: true;
  forecast_version: string;
  quality_passed: boolean;
  serving_mode: ServingMode;
  coverage: Coverage;
}

/** `GET /health`, пока снимок не загружен: все поля, кроме `ready`, равны null. */
export interface HealthNotReady {
  ready: false;
  forecast_version: null;
  quality_passed: null;
  serving_mode: null;
  coverage: null;
}

export type Health = HealthReady | HealthNotReady;

export interface RawForecastRow {
  route: RouteId;
  date: IsoDate;
  hour: number;
  prediction: number;
}

export interface RawForecastResponse {
  forecast_version: string;
  routes: RouteId[];
  group_by: 'raw';
  rows: RawForecastRow[];
}

/** Строка серверного агрегата: ключ корзины под именем `group_by` и сумма по всем выбранным маршрутам. */
export type AggregateForecastRow = { [K in AggregateGroupBy]: { [P in K]: string } & { prediction: number } }[AggregateGroupBy];

export interface AggregateForecastResponse {
  forecast_version: string;
  routes: RouteId[];
  group_by: AggregateGroupBy;
  rows: AggregateForecastRow[];
}

export interface ReferenceStop {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  sequence: number;
}

export interface ReferenceTrip {
  trip_id: string;
  direction: string;
  stops: ReferenceStop[];
}

export interface ReferenceRoute {
  route: RouteId;
  trips: ReferenceTrip[];
}

/** `GET /reference-map`. Без справочника сервис отдаёт `{forecast_available: false, routes: []}`. */
export interface ReferenceMap {
  schema_version?: number;
  source?: string;
  forecast_available: boolean;
  note?: string;
  routes: ReferenceRoute[];
}

/** Элемент списочного `detail` FastAPI (ошибка валидации параметров). */
export interface ValidationIssue {
  type: string;
  loc: (string | number)[];
  msg: string;
  input?: unknown;
  ctx?: Record<string, unknown>;
}

export type ErrorDetail = string | ValidationIssue[];

/** Параметры `/forecasts` и `/forecasts/export.csv`. */
export interface ForecastQuery {
  routes: readonly RouteId[];
  start: IsoDate;
  end: IsoDate;
  hour?: number | undefined;
  groupBy?: GroupBy | undefined;
}

// ---------------------------------------------------------------------------
// Проверка формы ответов

export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractError';
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(path: string, expected: string, value: unknown): never {
  const shown = JSON.stringify(value);
  throw new ContractError(`${path}: ожидалось ${expected}, получено ${shown === undefined ? 'undefined' : shown.slice(0, 80)}`);
}

export function isRouteId(value: unknown): value is RouteId {
  return typeof value === 'number' && (ROUTES as readonly number[]).includes(value);
}

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(path, 'объект', value);
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'строка', value);
  return value;
}

function expectDate(value: unknown, path: string): IsoDate {
  if (!isIsoDate(value)) fail(path, 'дата YYYY-MM-DD', value);
  return value;
}

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'конечное число', value);
  return value;
}

function expectRoute(value: unknown, path: string): RouteId {
  if (!isRouteId(value)) fail(path, `номер маршрута из ${ROUTES.join(', ')}`, value);
  return value;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'массив', value);
  return value;
}

export function parseHealth(value: unknown): Health {
  const body = expectRecord(value, 'health');
  if (body.ready === false) {
    return { ready: false, forecast_version: null, quality_passed: null, serving_mode: null, coverage: null };
  }
  if (body.ready !== true) fail('health.ready', 'true или false', body.ready);
  const mode = body.serving_mode;
  if (mode !== 'production' && mode !== 'diagnostic') fail('health.serving_mode', '"production" или "diagnostic"', mode);
  if (typeof body.quality_passed !== 'boolean') fail('health.quality_passed', 'логическое значение', body.quality_passed);
  const coverage = expectRecord(body.coverage, 'health.coverage');
  const start = expectDate(coverage.start, 'health.coverage.start');
  const end = expectDate(coverage.end, 'health.coverage.end');
  if (start > end) fail('health.coverage', 'start ≤ end', coverage);
  return {
    ready: true,
    forecast_version: expectString(body.forecast_version, 'health.forecast_version'),
    quality_passed: body.quality_passed,
    serving_mode: mode,
    coverage: { start, end },
  };
}

function parseRoutes(value: unknown, path: string): RouteId[] {
  return expectArray(value, path).map((item, index) => expectRoute(item, `${path}[${index}]`));
}

export function parseRawForecast(value: unknown): RawForecastResponse {
  const body = expectRecord(value, 'forecasts');
  if (body.group_by !== 'raw') fail('forecasts.group_by', '"raw"', body.group_by);
  const rows = expectArray(body.rows, 'forecasts.rows').map((item, index): RawForecastRow => {
    const path = `forecasts.rows[${index}]`;
    const row = expectRecord(item, path);
    const hour = expectNumber(row.hour, `${path}.hour`);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) fail(`${path}.hour`, 'целое от 0 до 23', hour);
    const prediction = expectNumber(row.prediction, `${path}.prediction`);
    if (prediction < 0) fail(`${path}.prediction`, 'неотрицательное число', prediction);
    return { route: expectRoute(row.route, `${path}.route`), date: expectDate(row.date, `${path}.date`), hour, prediction };
  });
  return {
    forecast_version: expectString(body.forecast_version, 'forecasts.forecast_version'),
    routes: parseRoutes(body.routes, 'forecasts.routes'),
    group_by: 'raw',
    rows,
  };
}

export function parseAggregateForecast(value: unknown): AggregateForecastResponse {
  const body = expectRecord(value, 'forecasts');
  const groupBy = body.group_by;
  if (typeof groupBy !== 'string' || groupBy === 'raw' || !(GROUP_BY as readonly string[]).includes(groupBy)) {
    fail('forecasts.group_by', 'агрегат hour|day|week|month|weekday|season', groupBy);
  }
  const key = groupBy as AggregateGroupBy;
  const rows = expectArray(body.rows, 'forecasts.rows').map((item, index) => {
    const path = `forecasts.rows[${index}]`;
    const row = expectRecord(item, path);
    return {
      [key]: expectString(row[key], `${path}.${key}`),
      prediction: expectNumber(row.prediction, `${path}.prediction`),
    } as AggregateForecastRow;
  });
  return {
    forecast_version: expectString(body.forecast_version, 'forecasts.forecast_version'),
    routes: parseRoutes(body.routes, 'forecasts.routes'),
    group_by: key,
    rows,
  };
}

export function parseReferenceMap(value: unknown): ReferenceMap {
  const body = expectRecord(value, 'reference-map');
  if (typeof body.forecast_available !== 'boolean') {
    fail('reference-map.forecast_available', 'логическое значение', body.forecast_available);
  }
  const routes = expectArray(body.routes, 'reference-map.routes').map((item, r): ReferenceRoute => {
    const routePath = `reference-map.routes[${r}]`;
    const route = expectRecord(item, routePath);
    return {
      route: expectRoute(route.route, `${routePath}.route`),
      trips: expectArray(route.trips, `${routePath}.trips`).map((tripItem, t): ReferenceTrip => {
        const tripPath = `${routePath}.trips[${t}]`;
        const trip = expectRecord(tripItem, tripPath);
        return {
          trip_id: expectString(trip.trip_id, `${tripPath}.trip_id`),
          direction: expectString(trip.direction, `${tripPath}.direction`),
          stops: expectArray(trip.stops, `${tripPath}.stops`).map((stopItem, s): ReferenceStop => {
            const stopPath = `${tripPath}.stops[${s}]`;
            const stop = expectRecord(stopItem, stopPath);
            return {
              stop_id: expectString(stop.stop_id, `${stopPath}.stop_id`),
              name: expectString(stop.name, `${stopPath}.name`),
              lat: expectNumber(stop.lat, `${stopPath}.lat`),
              lon: expectNumber(stop.lon, `${stopPath}.lon`),
              sequence: expectNumber(stop.sequence, `${stopPath}.sequence`),
            };
          }),
        };
      }),
    };
  });
  const result: ReferenceMap = { forecast_available: body.forecast_available, routes };
  if (typeof body.schema_version === 'number') result.schema_version = body.schema_version;
  if (typeof body.source === 'string') result.source = body.source;
  if (typeof body.note === 'string') result.note = body.note;
  return result;
}

/** Разбирает `detail` ответа об ошибке; неизвестная форма даёт `undefined`. */
export function parseErrorDetail(value: unknown): ErrorDetail | undefined {
  if (!isRecord(value)) return undefined;
  const detail = value.detail;
  if (typeof detail === 'string') return detail;
  if (!Array.isArray(detail)) return undefined;
  const issues: ValidationIssue[] = [];
  for (const item of detail) {
    if (!isRecord(item) || typeof item.type !== 'string' || typeof item.msg !== 'string' || !Array.isArray(item.loc)) {
      return undefined;
    }
    const loc = item.loc.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number');
    const issue: ValidationIssue = { type: item.type, loc, msg: item.msg };
    if ('input' in item) issue.input = item.input;
    if (isRecord(item.ctx)) issue.ctx = item.ctx;
    issues.push(issue);
  }
  return issues;
}
