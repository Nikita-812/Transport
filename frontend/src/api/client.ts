// Типизированный клиент существующего API. Все адреса относительные, того же origin (spec dashboard-shell):
// в сборке страницу отдаёт сам сервис, в разработке запросы проксирует Vite.
import { ApiError } from './errors';
import {
  ContractError,
  parseAggregateForecast,
  parseErrorDetail,
  parseHealth,
  parseRawForecast,
  parseReferenceMap,
  type AggregateForecastResponse,
  type AggregateGroupBy,
  type ForecastQuery,
  type Health,
  type IsoDate,
  type RawForecastResponse,
  type ReferenceMap,
  type RouteId,
} from './types';

/** Совместимая с `fetch` функция; mock-режим подменяет её синтетическим сервисом (design D3). */
export type Transport = (input: string, init?: RequestInit) => Promise<Response>;

const browserTransport: Transport = (input, init) => fetch(input, init);
let transport: Transport = browserTransport;

/** Подменяет транспорт: mock-адаптер в режиме разработки и тесты. */
export function setApiTransport(next: Transport | null): void {
  transport = next ?? browserTransport;
}

const ENDPOINTS = {
  health: '/health',
  forecasts: '/forecasts',
  exportCsv: '/forecasts/export.csv',
  submissionCsv: '/forecasts.csv',
  referenceMap: '/reference-map',
} as const;

/** Параметры запроса прогноза: `routes=1,17&start_date=…&end_date=…[&hour=…][&group_by=…]`. */
export function forecastSearchParams(query: ForecastQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set('routes', query.routes.join(','));
  params.set('start_date', query.start);
  params.set('end_date', query.end);
  if (query.hour !== undefined) params.set('hour', String(query.hour));
  if (query.groupBy !== undefined && query.groupBy !== 'raw') params.set('group_by', query.groupBy);
  return params;
}

/** Адрес `/forecasts` — для ссылок и отладки; данные берутся через `forecastRaw`. */
export function forecastsUrl(query: ForecastQuery): string {
  return `${ENDPOINTS.forecasts}?${forecastSearchParams(query).toString()}`;
}

/** Ссылка «Базовый прогноз (API)»: серверная CSV-выгрузка с теми же фильтрами. */
export function exportCsvUrl(query: ForecastQuery): string {
  return `${ENDPOINTS.exportCsv}?${forecastSearchParams(query).toString()}`;
}

/** Ссылка «Полный прогноз (submission)»: весь файл прогноза сервиса. */
export function submissionCsvUrl(): string {
  return ENDPOINTS.submissionCsv;
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError');
}

async function requestJson<T>(url: string, parse: (body: unknown) => T, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await transport(url, { signal: signal ?? null, headers: { Accept: 'application/json' } });
  } catch (error) {
    if (isAbort(error, signal)) throw new ApiError('aborted', 'Запрос отменён', { url, cause: error });
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiError('network', message, { url, cause: error });
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    if (isAbort(error, signal)) throw new ApiError('aborted', 'Запрос отменён', { url, cause: error });
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiError('network', message, { url, status: response.status, cause: error });
  }

  let body: unknown;
  let jsonError: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch (error) {
    jsonError = error;
  }

  if (!response.ok) {
    const detail = jsonError === undefined ? parseErrorDetail(body) : undefined;
    throw new ApiError('http', `HTTP ${response.status}`, {
      url,
      status: response.status,
      ...(detail === undefined ? {} : { detail }),
      body: text.slice(0, 500),
    });
  }

  if (jsonError !== undefined) {
    throw new ApiError('contract', 'Ответ не является JSON', { url, status: response.status, body: text.slice(0, 200), cause: jsonError });
  }

  try {
    return parse(body);
  } catch (error) {
    if (error instanceof ContractError) {
      throw new ApiError('contract', error.message, { url, status: response.status, cause: error });
    }
    throw error;
  }
}

/** `GET /health`: готовность, версия, режим и покрытие снимка. */
export function health(signal?: AbortSignal): Promise<Health> {
  return requestJson(ENDPOINTS.health, parseHealth, signal);
}

/**
 * Почасовой прогноз одного маршрута за включительный диапазон дат (design D4: запрос на маршрут, все параллельно).
 * Строки идут по дате и часу.
 */
export async function forecastRaw(route: RouteId, start: IsoDate, end: IsoDate, signal?: AbortSignal): Promise<RawForecastResponse> {
  const params = new URLSearchParams({ route: String(route), start_date: start, end_date: end });
  const url = `${ENDPOINTS.forecasts}?${params.toString()}`;
  const response = await requestJson(url, parseRawForecast, signal);
  const foreign = response.rows.find((row) => row.route !== route);
  if (foreign) {
    throw new ApiError('contract', `В ответе для маршрута ${route} есть строки маршрута ${foreign.route}`, { url });
  }
  return response;
}

/**
 * Серверный агрегат (сумма по всем выбранным маршрутам). Интерфейс считает агрегаты сам (design D4);
 * этот вызов нужен для сверки согласованности.
 */
export function forecastAggregate(query: ForecastQuery & { groupBy: AggregateGroupBy }, signal?: AbortSignal): Promise<AggregateForecastResponse> {
  return requestJson(forecastsUrl(query), parseAggregateForecast, signal);
}

/** `GET /reference-map`: остановки маршрутов 1, 5, 7, 11, 12 из справочника организаторов. */
export function referenceMap(signal?: AbortSignal): Promise<ReferenceMap> {
  return requestJson(ENDPOINTS.referenceMap, parseReferenceMap, signal);
}
