import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  exportCsvUrl,
  forecastAggregate,
  forecastRaw,
  forecastsUrl,
  health,
  referenceMap,
  setApiTransport,
  submissionCsvUrl,
  type Transport,
} from './client';
import { ApiError } from './errors';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function useTransport(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const transport = vi.fn<Transport>((url, init) => Promise.resolve(handler(url, init)));
  setApiTransport(transport);
  return transport;
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('ожидалась ошибка');
}

const HEALTH = {
  ready: true,
  forecast_version: 'pooled_route_blend:1ad02854ca82',
  quality_passed: false,
  serving_mode: 'diagnostic',
  coverage: { start: '2025-11-01', end: '2026-10-31' },
};

afterEach(() => setApiTransport(null));

describe('построители URL', () => {
  it('export.csv с маршрутами, датами, часом и группировкой', () => {
    expect(exportCsvUrl({ routes: [1, 17], start: '2025-11-01', end: '2025-11-30', hour: 8, groupBy: 'weekday' })).toBe(
      '/forecasts/export.csv?routes=1%2C17&start_date=2025-11-01&end_date=2025-11-30&hour=8&group_by=weekday',
    );
  });

  it('raw не добавляет group_by, час 0 не теряется', () => {
    expect(exportCsvUrl({ routes: [50], start: '2025-11-01', end: '2025-11-01', hour: 0, groupBy: 'raw' })).toBe(
      '/forecasts/export.csv?routes=50&start_date=2025-11-01&end_date=2025-11-01&hour=0',
    );
    expect(forecastsUrl({ routes: [5], start: '2025-12-01', end: '2025-12-31' })).toBe('/forecasts?routes=5&start_date=2025-12-01&end_date=2025-12-31');
  });

  it('полный файл прогноза', () => {
    expect(submissionCsvUrl()).toBe('/forecasts.csv');
  });
});

describe('health', () => {
  it('разбирает готовый ответ', async () => {
    const transport = useTransport(() => jsonResponse(200, HEALTH));
    await expect(health()).resolves.toEqual(HEALTH);
    expect(transport).toHaveBeenCalledWith('/health', expect.objectContaining({ headers: { Accept: 'application/json' } }));
  });

  it('разбирает неготовый ответ', async () => {
    useTransport(() => jsonResponse(200, { ready: false, forecast_version: null, quality_passed: null, serving_mode: null, coverage: null }));
    await expect(health()).resolves.toMatchObject({ ready: false, coverage: null });
  });

  it('неизвестный режим снимка — ошибка контракта', async () => {
    useTransport(() => jsonResponse(200, { ...HEALTH, serving_mode: 'weird' }));
    const error = await caught(health());
    expect(error.kind).toBe('contract');
    expect(error.message).toContain('serving_mode');
  });

  it('невалидная дата покрытия — ошибка контракта', async () => {
    useTransport(() => jsonResponse(200, { ...HEALTH, coverage: { start: '2025-02-30', end: '2026-10-31' } }));
    expect((await caught(health())).kind).toBe('contract');
  });

  it('не-JSON ответ — ошибка контракта', async () => {
    useTransport(() => new Response('<html>ok</html>', { status: 200 }));
    const error = await caught(health());
    expect(error.kind).toBe('contract');
    expect(error.body).toContain('<html>');
  });

  it('сетевая ошибка', async () => {
    const transport = vi.fn<Transport>(() => Promise.reject(new TypeError('Failed to fetch')));
    setApiTransport(transport);
    const error = await caught(health());
    expect(error.kind).toBe('network');
    expect(error.url).toBe('/health');
  });

  it('ответ 500 без JSON', async () => {
    useTransport(() => new Response('Internal Server Error', { status: 500 }));
    const error = await caught(health());
    expect(error).toMatchObject({ kind: 'http', status: 500, detail: undefined, body: 'Internal Server Error' });
  });

  it('отмена запроса', async () => {
    const controller = new AbortController();
    setApiTransport((_url, init) => {
      controller.abort();
      return Promise.reject(init?.signal?.reason instanceof Error ? init.signal.reason : new DOMException('aborted', 'AbortError'));
    });
    expect((await caught(health(controller.signal))).kind).toBe('aborted');
  });
});

describe('forecastRaw', () => {
  const rows = Array.from({ length: 24 }, (_, hour) => ({ route: 17, date: '2025-11-03', hour, prediction: hour * 10.5 }));

  it('запрашивает один маршрут и разбирает строки', async () => {
    const transport = useTransport(() => jsonResponse(200, { forecast_version: 'v:1', routes: [17], group_by: 'raw', rows }));
    const response = await forecastRaw(17, '2025-11-03', '2025-11-03');
    expect(transport.mock.calls[0]?.[0]).toBe('/forecasts?route=17&start_date=2025-11-03&end_date=2025-11-03');
    expect(response.rows).toHaveLength(24);
    expect(response.rows[8]).toEqual({ route: 17, date: '2025-11-03', hour: 8, prediction: 84 });
  });

  it('передаёт signal транспорту', async () => {
    const transport = useTransport(() => jsonResponse(200, { forecast_version: 'v:1', routes: [17], group_by: 'raw', rows }));
    const controller = new AbortController();
    await forecastRaw(17, '2025-11-03', '2025-11-03', controller.signal);
    expect(transport.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it('строка чужого маршрута — ошибка контракта', async () => {
    useTransport(() => jsonResponse(200, { forecast_version: 'v:1', routes: [17], group_by: 'raw', rows: [{ ...rows[0], route: 1 }] }));
    expect((await caught(forecastRaw(17, '2025-11-03', '2025-11-03'))).kind).toBe('contract');
  });

  it('отрицательный прогноз — ошибка контракта', async () => {
    useTransport(() => jsonResponse(200, { forecast_version: 'v:1', routes: [17], group_by: 'raw', rows: [{ ...rows[0], prediction: -1 }] }));
    expect((await caught(forecastRaw(17, '2025-11-03', '2025-11-03'))).kind).toBe('contract');
  });

  it('422 со строковым detail', async () => {
    useTransport(() => jsonResponse(422, { detail: 'date range is outside the forecast snapshot coverage' }));
    const error = await caught(forecastRaw(17, '2024-01-01', '2024-01-01'));
    expect(error).toMatchObject({ kind: 'http', status: 422, detail: 'date range is outside the forecast snapshot coverage' });
  });

  it('422 со списочным detail', async () => {
    const detail = [{ type: 'missing', loc: ['query', 'start_date'], msg: 'Field required', input: null }];
    useTransport(() => jsonResponse(422, { detail }));
    const error = await caught(forecastRaw(17, '', '2025-11-01'));
    expect(error.detail).toEqual(detail);
  });
});

describe('forecastAggregate и referenceMap', () => {
  it('серверный агрегат по дням недели', async () => {
    const transport = useTransport(() =>
      jsonResponse(200, { forecast_version: 'v:1', routes: [1, 17], group_by: 'weekday', rows: [{ weekday: '0', prediction: 258093.26 }] }),
    );
    const response = await forecastAggregate({ routes: [1, 17], start: '2025-11-01', end: '2025-11-30', groupBy: 'weekday' });
    expect(transport.mock.calls[0]?.[0]).toBe('/forecasts?routes=1%2C17&start_date=2025-11-01&end_date=2025-11-30&group_by=weekday');
    expect(response.rows).toEqual([{ weekday: '0', prediction: 258093.26 }]);
  });

  it('пустой справочник', async () => {
    useTransport(() => jsonResponse(200, { forecast_available: false, routes: [] }));
    await expect(referenceMap()).resolves.toEqual({ forecast_available: false, routes: [] });
  });

  it('остановка без координат — ошибка контракта', async () => {
    useTransport(() =>
      jsonResponse(200, {
        forecast_available: false,
        routes: [{ route: 1, trips: [{ trip_id: '1', direction: '0', stops: [{ stop_id: '1', name: 'A', sequence: 1 }] }] }],
      }),
    );
    expect((await caught(referenceMap())).message).toContain('lat');
  });
});
